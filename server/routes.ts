import { Router, type Request, type Response, type NextFunction } from 'express';
import db from './db.js';
import { sameInbox, normaliseEmail, approverKindFor, isStrong } from './hours.js';
import { newEventSecret, newPrintedCode, liveCodeFor, secondsLeft, verifyLiveCode } from './eventcodes.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID, randomBytes } from 'crypto';
import { toAppLocalString } from './time.js';
import { sendVerificationEmail, sendPasswordResetEmail, sendSignupNotificationEmail, sendPostApprovedEmail, sendPostDeniedEmail, sendEventCancelledEmail, sendEventReminderEmail, sendOnboardingNudgeEmail, sendVerifyThenSurveyEmail, sendHourApprovalRequest, sendHourDecisionNotice, sendAttendanceRequest } from './email.js';
import { verifyGoogleToken, usernameFrom, googleEnabled, googleClientId, normaliseEmail } from './google.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure uploads directory exists — use the same persistent disk as the DB in production
const dbPath = process.env.DB_PATH;
const uploadsDir = dbPath
  ? path.join(path.dirname(dbPath), 'uploads')
  : path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// The four formats a browser renders as a picture and cannot execute. SVG is
// deliberately absent: it is a document, it can carry script, and it would
// reopen exactly the hole the rest of this block closes.
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/** The first bytes of a real file of each type. */
const MAGIC: { ext: string; bytes: number[] }[] = [
  { ext: '.jpg',  bytes: [0xFF, 0xD8, 0xFF] },
  { ext: '.png',  bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { ext: '.gif',  bytes: [0x47, 0x49, 0x46, 0x38] },
];

/** True when the file on disk really is the picture it claims to be.
 *  WebP is RIFF....WEBP, so it needs a look at bytes 8-11 rather than a prefix. */
function looksLikeRealImage(filePath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(12);
    const read = fs.readSync(fd, head, 0, 12, 0);
    if (read < 4) return false;
    if (MAGIC.some(m => m.bytes.every((b, i) => head[i] === b))) return true;
    return head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

// Multer config — store on disk with unique filenames, images only, 5 MB max.
//
// The extension is taken from our own table, never from the uploaded
// filename, and the declared type must be one of the four above. Previously
// both came from whatever the sender supplied: a file called "x.html"
// labelled "image/png" was accepted and then served back from our own domain
// as a real web page, which is a working account-takeover against anyone who
// opened the link. The bytes are checked as well, in handleUpload.
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}${ALLOWED_IMAGE_TYPES[file.mimetype] ?? '.bin'}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, GIF or WebP images are allowed'));
    }
  },
});

const router = Router();

// Unlike ADMIN_EMAIL below, this one can't just warn and fall back: the
// fallback string is sitting in source, so a production deploy that forgets
// to set JWT_SECRET would sign every login with a secret anyone can read and
// forge an admin token from. Refuse to boot instead.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable must be set in production.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'locallink-dev-secret-change-in-production';
const SALT_ROUNDS = 12;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'linklocal2@gmail.com';

// ===== Shared helpers =====

/** Safe JSON.parse — returns `fallback` instead of throwing on malformed input */
function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** Attach validated tags JSON to an opportunity row */
function withTags(opp: any, signups: string[] = []) {
  return { ...opp, tags: safeJsonParse<string[]>(opp.tags, []), steps: safeJsonParse<string[]>(opp.steps, []), signups, hostVerified: !!opp.hostVerified };
}

/** Whether a volunteer is under 18, derived from the stored year every time
 * rather than frozen at signup — a flag written once would still call
 * someone a minor years after they stopped being one.
 *
 * Year-only comparison, so it flips on 1 January of the year they turn 18
 * rather than on the birthday itself. Deliberate: for age GATES this is the
 * cautious direction only if we treat the unknown-birthday window as still
 * a minor, which `birthYear` alone cannot distinguish. Returns null when
 * unknown (organizations, and anyone who registered before this existed),
 * and callers must not read null as "adult". */
function isMinor(birthYear: number | null | undefined): boolean | null {
  if (!birthYear) return null;
  return new Date().getFullYear() - birthYear < 18;
}

/** The onboarding questionnaire fields, in the shape every user-facing
 * response returns them. Used by every route that builds a client-facing
 * user object (login, verify-email, PUT /auth/profile) so `currentUser`
 * always carries accurate onboarding status regardless of which of those
 * three paths logged someone in. */
function onboardingFields(user: any) {
  return {
    onboardingHoursSoFar: user.onboardingHoursSoFar ?? null,
    onboardingInterests: safeJsonParse<string[]>(user.onboardingInterests, []),
    onboardingMajors: user.onboardingMajors || null,
    onboardingGoalHours: user.onboardingGoalHours ?? null,
    onboardingGoalEvents: user.onboardingGoalEvents ?? null,
    onboardingTowns: safeJsonParse<string[]>(user.onboardingTowns, []),
    onboardingAvailability: safeJsonParse<string[]>(user.onboardingAvailability, []),
    onboardingCompletedAt: user.onboardingCompletedAt || null,
  };
}

// Optional external signup URL on a post — validated only when non-blank.
// Mirrored client-side in client/src/lib/utils.ts.
function getExternalSignupUrlError(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Enter a full web address, starting with http:// or https://';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Signup page must start with http:// or https://';
  }
  return null;
}

// Length caps for free text. Mirrors LIMITS in client/src/lib/utils.ts — keep
// the two in sync. This copy is the one that matters: the form's limits are a
// courtesy, and anything posting straight to the API skips them. Without these
// a 50,000-character description and a 300-character unbroken title were both
// accepted, and neither can wrap inside a card.
const LIMITS = {
  title: 120,
  description: 2000,
  location: 200,
  step: 200,
  steps: 12,
  orgDescription: 1500,
  externalSignupUrl: 500,
} as const;

/** Returns an error string when a field is over its cap, else null. */
function getLengthError(field: keyof typeof LIMITS, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const max = LIMITS[field];
  const len = value.trim().length;
  return len > max ? `Keep this under ${max} characters (currently ${len})` : null;
}

// Allowed enum values — validated server-side to prevent garbage data
const VALID_SPOTS_TYPES  = ['limited', 'unlimited', 'none'] as const;
// The five activity categories a new post can use, plus the five it used to be
// able to. The old ones stay accepted because existing posts still carry them
// and would otherwise fail validation the moment anyone edited one.
// Mirrors ActivityCategory / LegacyCategory in client/src/lib/mockData.ts.
const VALID_CATEGORIES   = [
  'hands-on', 'teaching', 'events', 'care', 'backstage',
  'volunteer', 'education', 'fitness', 'environment', 'community',
] as const;
const VALID_PINNED_SIZES = ['small', 'medium', 'large'] as const;
// Mirrors TOWNS in client/src/lib/mockData.ts — keep the two lists in sync
const VALID_TOWNS = [
  'Montgomery/Skillman', 'Hillsborough', 'Princeton', 'Bridgewater',
  'Somerville', 'Franklin Township', 'Manville', 'Raritan',
  'Belle Mead/Rocky Hill', 'Flemington', 'Basking Ridge', 'Bedminster',
  'Bernardsville', 'Bound Brook', 'Branchburg', 'Far Hills', 'Green Brook',
  'Millstone', 'North Plainfield', 'Peapack-Gladstone', 'South Bound Brook',
  'Warren', 'Watchung', 'Pittstown', 'Trenton'
] as const;

// Mirrors FIELD_TAGS in client/src/lib/mockData.ts — keep the two lists in
// sync. Used to whitelist the onboarding questionnaire's interest tags.
const VALID_FIELD_TAGS = [
  'Environment', 'Animals', 'Food & Hunger', 'Housing',
  'Health & Medical', 'Emergency Services', 'Senior Services',
  'Education', 'Arts & Culture', 'Sports & Fitness',
  'Faith & Spiritual', 'Youth & Children', 'Social Services',
  'Technology', 'Tutoring', 'Workforce Dev', 'Civic Engagement',
  'Disability Services', 'Cultural Diversity', 'Mental Health',
  'Financial Aid', 'Legal Aid', 'Agriculture', 'Transportation',
  'After-School', 'Family Support', 'Performing Arts', 'Media',
  'Science & Research', 'Conflict Resolution', 'Global Outreach',
  'Events & Festivals', 'History & Heritage', 'Sustainability',
  'Community Dev', 'Advocacy', 'School Supplies',
  'Behavioral Health', 'Public Safety', 'Early Childhood',
  'Outdoor Education', 'Maternal Health', 'Peer Mentorship',
  'Digital Literacy', 'Music', 'Skilled Trades',
  'Urban Gardening', 'Service Animals', 'Chronic Illness',
  'Econ. Empowerment',
] as const;

type SpotsType = typeof VALID_SPOTS_TYPES[number];

// Light guardrails on the location field — it renders as a Google Maps link
// client-side, so catch obvious non-addresses (placeholder notes, schedule
// text) without blocking real-but-unusual addresses. Mirrors
// client/src/lib/utils.ts's getLocationError; only applied to the org-facing
// create/edit routes, never the dedicated admin route, so admins always have
// an escape hatch to fix existing bad data.
const LOCATION_BLOCKLIST = ['will be given', 'sign up', 'tbd', 'beginning'];
function getLocationError(location: string): string | null {
  const trimmed = location.trim();
  if (trimmed.length < 5) return 'Location must be at least 5 characters';
  if (trimmed.length > 100) return 'Location must be under 100 characters';
  const lower = trimmed.toLowerCase();
  if (LOCATION_BLOCKLIST.some(phrase => lower.includes(phrase))) {
    return "Location must be a real address or place name, not a note (avoid phrases like 'sign up' or 'TBD')";
  }
  return null;
}

// ===== Auth Middleware =====

interface AuthRequest extends Request {
  userId?: string;
  isAdmin?: boolean;
}

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; isAdmin: boolean };
    // The JWT is stateless -- a valid signature only proves it was issued by
    // this server, not that the account it names is still there. A deleted
    // user's token stays "valid" until it expires (up to 30 days), and
    // without this check they could keep authenticating: reads would just
    // return nothing, but a write with a foreign key on userId (a signup,
    // for instance) would hit that constraint and surface as a raw 500,
    // which every caller then has to somehow explain to someone who has no
    // idea their account is gone. One extra indexed lookup, on every
    // authenticated request, closes it here instead of at each insert.
    const user = db.prepare('SELECT banned, isAdmin FROM users WHERE id = ?').get(payload.userId) as
      { banned: number; isAdmin: number } | undefined;
    if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
    // A ban has to bite now, not in 30 days. Login already refuses a banned
    // account, but a token issued before the ban stays valid on its own
    // signature — so without this, banning someone who is already signed in
    // does nothing at all until that token expires, and they keep posting.
    // 401, not 403, on purpose: every caller in the client already treats a
    // 401 as "this session is dead, log out", and none of them handle a 403.
    // Returning 403 here would leave a banned user staring at dead buttons
    // instead of being bounced to the login screen — where logging in gives
    // them the real suspended message and the appeal form.
    if (user.banned) return res.status(401).json({ error: 'Your account has been suspended.' });
    req.userId = payload.userId;
    // Read admin off the row rather than the token for the same reason: a
    // 30-day token would otherwise keep granting admin after the flag is gone.
    req.isAdmin = !!user.isAdmin;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.isAdmin) return res.status(403).json({ error: 'Admin access denied' });
    next();
  });
}

/** Like requireAuth but doesn't block unauthenticated requests — just attaches userId/isAdmin if a valid token is present */
function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string; isAdmin: boolean };
      req.userId = payload.userId;
      req.isAdmin = payload.isAdmin;
    } catch { /* expired / invalid — proceed as anonymous */ }
  }
  next();
}

// ===== AUTH =====

/**
 * The user's live 24-hour email-confirmation token, minting one if they have
 * none that still works.
 *
 * Reuse rather than replace, because the caller sends mail *after* this
 * returns and that send can fail. Deleting first meant a Brevo rejection left
 * the person with a link in their inbox that no longer worked and no
 * replacement on the way -- and even on success, the older mail they had
 * already received went dead the moment the newer one was minted. Re-sending
 * the same link is the safer thing and is just as good: it is the same 24-hour
 * window either way.
 *
 * Expired rows are cleared as we go, so a user still only ever has one live
 * token -- verifying issues a 30-day session, so each one is a working login
 * link for that account and two open doors is one too many.
 */
function mintVerificationToken(userId: string): string {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM email_verifications WHERE userId = ? AND expiresAt <= ?').run(userId, now);
  const live = db.prepare(
    'SELECT token FROM email_verifications WHERE userId = ? ORDER BY expiresAt DESC LIMIT 1'
  ).get(userId) as { token: string } | undefined;
  if (live) return live.token;

  const token = randomUUID() + '-' + randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO email_verifications (token, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)'
  ).run(token, userId, expiresAt, now);
  return token;
}

router.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { username, email, password, accountType, joinSlug, birthYear } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Usernames appear in emails and UI — restrict to a safe charset.
    // Applies to new registrations only; existing accounts are untouched.
    if (!/^[a-zA-Z0-9_\- ]{3,30}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3–30 characters using only letters, numbers, spaces, hyphens, or underscores' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const validAccountTypes = ['volunteer', 'organization'];
    const resolvedAccountType = validAccountTypes.includes(accountType) ? accountType : 'volunteer';

    // Volunteers give a birth year; organizations aren't people. Thirteen is
    // the floor because under-13 accounts bring verifiable-parental-consent
    // duties that a site this size cannot realistically meet — refusing at
    // the door means never holding data that carries obligations we can't
    // honour. Only the year is taken, and no response ever returns it.
    let resolvedBirthYear: number | null = null;
    if (resolvedAccountType === 'volunteer') {
      const year = Number(birthYear);
      const thisYear = new Date().getFullYear();
      if (!Number.isInteger(year) || year < thisYear - 120 || year > thisYear) {
        return res.status(400).json({ error: 'Please choose the year you were born' });
      }
      // Compares years only, so someone whose birthday hasn't landed yet is
      // treated as the older age. Erring toward "old enough" on a boundary
      // is the wrong direction for a floor, so subtract a year of slack.
      if (thisYear - year < 13) {
        return res.status(403).json({ error: 'You need to be at least 13 to use LocalLink.' });
      }
      resolvedBirthYear = year;
    }

    // Validate join link if provided
    let joinLink: any = null;
    if (joinSlug) {
      joinLink = db.prepare('SELECT * FROM onboarding_links WHERE slug = ? AND claimedAt IS NULL').get(joinSlug);
      // Invalid or already-claimed slug — just proceed normally (don't block registration)
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existing) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const isAdmin = email === ADMIN_EMAIL ? 1 : 0;
    // Auto-verify when: admin email, no Brevo API key configured, or registered via a valid join link
    const emailVerified = (isAdmin || !process.env.BREVO_API_KEY || !!joinLink) ? 1 : 0;
    // Grant verified badge automatically for join-link registrations
    const verified = joinLink ? 1 : 0;
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const unsubToken = randomUUID();

    db.prepare(
      'INSERT INTO users (id, username, email, emailNorm, password, isAdmin, emailVerified, accountType, hasSeenWelcome, unsubToken, verified, notifyOnInterest, birthYear, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    ).run(id, username, email, normaliseEmail(email), hashedPassword, isAdmin, emailVerified, resolvedAccountType, 0, unsubToken, verified, resolvedBirthYear, createdAt);

    // If registered via join link, claim it
    if (joinLink) {
      db.prepare('UPDATE onboarding_links SET claimedAt = ?, claimedBy = ? WHERE slug = ?').run(createdAt, id, joinSlug);
    }

    // Generate a verification token (expires in 24 hours) — only needed if email verification is required
    if (!emailVerified) {
      const verificationToken = randomUUID() + '-' + randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        'INSERT INTO email_verifications (token, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)'
      ).run(verificationToken, id, expiresAt, createdAt);

      sendVerificationEmail(email, username, verificationToken).catch((err) => {
        console.error('Failed to send verification email:', err.message);
      });
    }

    const needsVerification = !emailVerified;
    return res.status(201).json({
      needsVerification,
      email,
      message: needsVerification
        ? 'Account created. Please check your email to verify your account.'
        : 'Account created. You can now log in.',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Fetch user including hashed password
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Block banned users from logging in
    if (user.banned) {
      return res.status(403).json({
        error: 'Your account has been suspended.',
        suspended: true,
        email: user.email,
      });
    }

    // Block login if email is not yet verified
    if (!user.emailVerified) {
      return res.status(403).json({
        error: 'Email not verified',
        email: user.email,
        needsVerification: true,
      });
    }

    const token = jwt.sign({ userId: user.id, isAdmin: !!user.isAdmin }, JWT_SECRET, { expiresIn: '30d' });
    // Never send the hashed password to the client
    // birthYear is stripped alongside the password: it exists only to
    // derive "under 18" for organizations, and this payload gets persisted
    // to localStorage by the client.
    const { password: _pwd, birthYear: _by, ...safeUser } = user;
    return res.json({ ...safeUser, isAdmin: !!user.isAdmin, emailVerified: true, notifyOnInterest: !!user.notifyOnInterest, notifyOnReopen: user.notifyOnReopen !== 0, profileImage: user.profileImage || null, emailReminders: !!user.emailReminders, hasSeenWelcome: !!user.hasSeenWelcome, verified: !!user.verified, ...onboardingFields(user), token });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Verify email via token link
router.get('/api/auth/verify-email', (req: Request, res: Response) => {
  try {
    const { token } = req.query as { token?: string };
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const record = db.prepare('SELECT * FROM email_verifications WHERE token = ?').get(token) as any;
    if (!record) return res.status(400).json({ error: 'Invalid or already used verification link' });

    if (new Date(record.expiresAt) < new Date()) {
      db.prepare('DELETE FROM email_verifications WHERE token = ?').run(token);
      return res.status(400).json({ error: 'Verification link has expired. Please request a new one.' });
    }

    // Mark user as verified and delete the used token
    db.prepare('UPDATE users SET emailVerified = 1 WHERE id = ?').run(record.userId);
    db.prepare('DELETE FROM email_verifications WHERE token = ?').run(token);

    // Issue a JWT so the client can log the user in automatically
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(record.userId) as any;
    const jwtToken = jwt.sign({ userId: user.id, isAdmin: !!user.isAdmin }, JWT_SECRET, { expiresIn: '30d' });
    // birthYear is stripped alongside the password: it exists only to
    // derive "under 18" for organizations, and this payload gets persisted
    // to localStorage by the client.
    const { password: _pwd, birthYear: _by, ...safeUser } = user;

    return res.json({
      success: true,
      message: 'Email verified!',
      token: jwtToken,
      ...safeUser,
      isAdmin: !!user.isAdmin,
      emailVerified: true,
      notifyOnInterest: !!user.notifyOnInterest,
      notifyOnReopen: user.notifyOnReopen !== 0,
      profileImage: user.profileImage || null,
      emailReminders: !!user.emailReminders,
      hasSeenWelcome: !!user.hasSeenWelcome,
      ...onboardingFields(user),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Resend verification email
router.post('/api/auth/resend-verification', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const user = db.prepare('SELECT id, username, email, emailVerified FROM users WHERE email = ?').get(email) as any;
    // Always return success to avoid exposing whether an email is registered
    if (!user || user.emailVerified) {
      return res.json({ success: true, message: 'If that email is registered and unverified, a new link has been sent.' });
    }

    const newToken = mintVerificationToken(user.id);

    sendVerificationEmail(user.email, user.username, newToken).catch((err) => {
      console.error('Failed to resend verification email:', err.message);
    });

    return res.json({ success: true, message: 'Verification email resent. Please check your inbox.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Forgot password — sends reset link email
router.post('/api/auth/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const user = db.prepare('SELECT id, username, email FROM users WHERE email = ?').get(email) as any;
    // Always return success to avoid email enumeration
    if (!user) return res.json({ success: true });

    db.prepare('DELETE FROM password_resets WHERE userId = ?').run(user.id);
    const token = randomUUID() + '-' + randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.prepare('INSERT INTO password_resets (token, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)')
      .run(token, user.id, expiresAt, new Date().toISOString());

    sendPasswordResetEmail(user.email, user.username, token).catch((err) => {
      console.error('Failed to send password reset email:', err.message);
    });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Reset password using token from email
router.post('/api/auth/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Missing token or password' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const record = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token) as any;
    if (!record) return res.status(400).json({ error: 'Invalid or already used reset link' });

    if (new Date(record.expiresAt) < new Date()) {
      db.prepare('DELETE FROM password_resets WHERE token = ?').run(token);
      return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, record.userId);
    db.prepare('DELETE FROM password_resets WHERE token = ?').run(token);

    return res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Edit profile (username and/or password and/or notification settings and/or profile image)
router.put('/api/auth/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { username, currentPassword, newPassword, notifyOnInterest, notifyOnReopen, profileImage, orgDescription, orgWebsite, orgEmail, orgPhone, emailReminders, accountType } = req.body;
    const userId = req.userId!;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Account type: one-way, volunteer -> organization only.
    //
    // Upgrading is safe because it grants no ability to publish unreviewed: every
    // non-admin post is inserted with status 'pending' and has to clear the admin
    // queue. Before this existed the type was fixed at registration with no way to
    // change it, while the UI told people to "update your account type in settings"
    // — a setting that did not exist.
    //
    // The reverse is refused on purpose: an organization's posts are keyed to it as
    // host, and demoting would leave those posts owned by an account that is no
    // longer allowed to own them.
    if (accountType !== undefined && accountType !== user.accountType) {
      if (user.accountType === 'volunteer' && accountType === 'organization') {
        db.prepare('UPDATE users SET accountType = ? WHERE id = ?').run('organization', userId);
      } else {
        return res.status(400).json({
          error: 'Organization accounts cannot be changed back. Contact support if this is wrong.',
        });
      }
    }

    if (username && username.trim() && username.trim() !== user.username) {
      const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), userId);
      if (taken) return res.status(409).json({ error: 'Username already taken' });
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username.trim(), userId);
    }

    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password required to change password' });
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
      if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
      const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, userId);
    }

    if (typeof notifyOnInterest === 'boolean') {
      db.prepare('UPDATE users SET notifyOnInterest = ? WHERE id = ?').run(notifyOnInterest ? 1 : 0, userId);
    }

    if (typeof notifyOnReopen === 'boolean') {
      db.prepare('UPDATE users SET notifyOnReopen = ? WHERE id = ?').run(notifyOnReopen ? 1 : 0, userId);
    }

    if (profileImage !== undefined) {
      db.prepare('UPDATE users SET profileImage = ? WHERE id = ?').run(profileImage || null, userId);
    }

    if (orgDescription !== undefined) {
      const lengthError = getLengthError('orgDescription', orgDescription);
      if (lengthError) return res.status(400).json({ error: lengthError });
      db.prepare('UPDATE users SET orgDescription = ? WHERE id = ?').run(orgDescription || null, userId);
    }
    if (orgWebsite !== undefined) {
      db.prepare('UPDATE users SET orgWebsite = ? WHERE id = ?').run(orgWebsite || null, userId);
    }
    if (orgEmail !== undefined) {
      db.prepare('UPDATE users SET orgEmail = ? WHERE id = ?').run(orgEmail || null, userId);
    }
    if (orgPhone !== undefined) {
      db.prepare('UPDATE users SET orgPhone = ? WHERE id = ?').run(orgPhone || null, userId);
    }

    if (typeof emailReminders === 'boolean') {
      db.prepare('UPDATE users SET emailReminders = ? WHERE id = ?').run(emailReminders ? 1 : 0, userId);
    }

    const updated = db.prepare(
      'SELECT id, username, email, isAdmin, emailVerified, accountType, notifyOnInterest, notifyOnReopen, profileImage, orgDescription, orgWebsite, orgEmail, orgPhone, emailReminders, hasSeenWelcome, verified, createdAt, onboardingHoursSoFar, onboardingInterests, onboardingMajors, onboardingGoalHours, onboardingGoalEvents, onboardingTowns, onboardingAvailability, onboardingCompletedAt FROM users WHERE id = ?'
    ).get(userId) as any;
    return res.json({
      ...updated,
      isAdmin: !!updated.isAdmin,
      emailVerified: !!updated.emailVerified,
      notifyOnInterest: !!updated.notifyOnInterest,
      notifyOnReopen: updated.notifyOnReopen !== 0,
      profileImage: updated.profileImage || null,
      emailReminders: !!updated.emailReminders,
      hasSeenWelcome: !!updated.hasSeenWelcome,
      verified: !!updated.verified,
      ...onboardingFields(updated),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== ONBOARDING QUESTIONNAIRE =====
// Every field is independently optional; what makes the questionnaire
// "done" is submitting at all, not filling in any particular answer. That
// mirrors how it's presented client-side: one screen, nothing required,
// and hitting Save (even mostly blank) stops the prompt from reappearing —
// only Skip leaves it owed.
const MAX_ONBOARDING_TEXT = 200;
// Mirrors getPostTimeBucket in client/src/lib/categoryUtils.ts -- keep the
// three ids in sync, since a mismatch would make an availability answer
// silently never match anything.
const VALID_AVAILABILITY = ['weekday-day', 'weekday-evening', 'weekend'] as const;

router.post('/api/me/onboarding', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT accountType FROM users WHERE id = ?').get(req.userId) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });
    // The question set (majors, college plans, hours-so-far) presumes a
    // person volunteering, not an organization posting events.
    if (user.accountType !== 'volunteer') {
      return res.status(403).json({ error: 'The questionnaire is for volunteer accounts.' });
    }

    const { hoursSoFar, interests, majors, goalHours, goalEvents, towns, availability } = req.body || {};

    const numOrNull = (v: unknown): number | null => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : null;
    };
    // Whitelisted against the real tag list rather than trusted as free
    // text — the same tags a post can be filed under, so an answer here is
    // never a category that couldn't also describe an event.
    const cleanInterests = Array.isArray(interests)
      ? interests.filter((t: unknown) => typeof t === 'string' && (VALID_FIELD_TAGS as readonly string[]).includes(t))
      : [];
    const cleanMajors = typeof majors === 'string' ? majors.trim().slice(0, MAX_ONBOARDING_TEXT) : null;
    // Same whitelisting logic as interests, against the two lists a post
    // itself is already constrained to -- an answer here can never name a
    // town or time slot that no post could actually have.
    const cleanTowns = Array.isArray(towns)
      ? towns.filter((t: unknown) => typeof t === 'string' && (VALID_TOWNS as readonly string[]).includes(t))
      : [];
    const cleanAvailability = Array.isArray(availability)
      ? availability.filter((a: unknown) => typeof a === 'string' && (VALID_AVAILABILITY as readonly string[]).includes(a))
      : [];

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE users SET onboardingHoursSoFar = ?, onboardingInterests = ?, onboardingMajors = ?,
       onboardingGoalHours = ?, onboardingGoalEvents = ?, onboardingTowns = ?, onboardingAvailability = ?,
       onboardingCompletedAt = ? WHERE id = ?`
    ).run(
      numOrNull(hoursSoFar), JSON.stringify(cleanInterests), cleanMajors || null,
      numOrNull(goalHours), numOrNull(goalEvents), JSON.stringify(cleanTowns), JSON.stringify(cleanAvailability),
      now, req.userId
    );

    // Someone can complete it from the Profile reminder card or a fresh
    // session prompt without ever clicking the bell notification a past
    // skip created -- leaving that notification unread forever even though
    // the thing it was reminding about is now done. Same dedup id as
    // remind-later, so this is a no-op when it was never created.
    // Every outstanding reminder, not just the one with the fixed id. An admin
    // writing their own wording through the bell creates a row with its own
    // id, so keying on the fixed one left those unread forever -- the bell
    // still said "Answer it now" about a questionnaire that was already
    // answered, and tapping it did nothing, because the modal refuses to open
    // once onboardingCompletedAt is set.
    db.prepare(
      "UPDATE notifications SET read = 1 WHERE userId = ? AND type = 'onboarding_reminder'"
    ).run(req.userId);

    const updated = db.prepare(
      'SELECT onboardingHoursSoFar, onboardingInterests, onboardingMajors, onboardingGoalHours, onboardingGoalEvents, onboardingTowns, onboardingAvailability, onboardingCompletedAt FROM users WHERE id = ?'
    ).get(req.userId) as any;
    return res.json(onboardingFields(updated));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** Called when someone exits the questionnaire without submitting.
 *
 * A deterministic id (one per user, not one per skip) keyed through INSERT
 * OR IGNORE is the same dedup trick notifyMilestones uses: clicking Skip
 * five times across five sessions writes the row once, not five bell
 * entries repeating the same nudge. If they already completed it since the
 * last skip, this still runs harmlessly -- it would only re-arm a
 * notification that the modal itself won't act on, since the modal never
 * opens once onboardingCompletedAt is set regardless of who calls
 * showOnboardingPrompt(). */
router.post('/api/me/onboarding/remind-later', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT accountType, onboardingCompletedAt FROM users WHERE id = ?').get(req.userId) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.accountType !== 'volunteer' || user.onboardingCompletedAt) {
      return res.json({ reminded: false });
    }
    db.prepare(
      'INSERT OR IGNORE INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(
      `onboarding-reminder-${req.userId}`, req.userId, 'onboarding_reminder',
      "You skipped the \"tell us about you\" questionnaire — takes under a minute, and helps us show you a better fit.",
      new Date().toISOString()
    );
    return res.json({ reminded: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Public host profile — returns only username + profileImage, no auth required
router.get('/api/users/:id/profile', (req: Request, res: Response) => {
  try {
    const user = db.prepare(
      'SELECT username, profileImage, accountType, orgWebsite FROM users WHERE id = ?'
    ).get(req.params.id) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });
    // orgWebsite only for organizations — it is already public on their own
    // profile page, but this endpoint answers for volunteers too and their
    // row should not start carrying fields that only mean something for orgs.
    return res.json({
      username: user.username,
      profileImage: user.profileImage || null,
      orgWebsite: user.accountType === 'organization' ? (user.orgWebsite || null) : null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Public org profile page — returns org info + all approved posts
router.get('/api/org/:id', (req: Request, res: Response) => {
  try {
    const user = db.prepare(
      'SELECT id, username, profileImage, accountType, orgDescription, orgWebsite, orgEmail, orgPhone, verified, createdAt FROM users WHERE id = ? AND accountType = ?'
    ).get(req.params.id, 'organization') as any;
    if (!user) return res.status(404).json({ error: 'Organization not found' });

    const posts = db.prepare(
      "SELECT * FROM opportunities WHERE hostId = ? AND status = 'approved' ORDER BY createdAt DESC"
    ).all(req.params.id) as any[];
    const getSignups = db.prepare('SELECT userId FROM signups WHERE opportunityId = ?');
    const postsWithData = posts.map(opp =>
      withTags(opp, (getSignups.all(opp.id) as any[]).map((s: any) => s.userId))
    );

    return res.json({
      ...user,
      profileImage: user.profileImage || null,
      verified: !!user.verified,
      posts: postsWithData,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== OPPORTUNITIES =====

router.get('/api/opportunities', (_req: Request, res: Response) => {
  try {
    // Public feed: only show approved posts, join with users to get hostVerified
    const opportunities = db.prepare(
      "SELECT o.*, u.verified as hostVerified FROM opportunities o LEFT JOIN users u ON o.hostId = u.id WHERE o.status = 'approved' ORDER BY o.createdAt DESC"
    ).all() as any[];
    const getSignups = db.prepare('SELECT userId FROM signups WHERE opportunityId = ?');
    const result = opportunities.map(opp =>
      withTags(opp, (getSignups.all(opp.id) as any[]).map((s: any) => s.userId))
    );
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/opportunities/:id', (req: Request, res: Response) => {
  try {
    // JOIN on users to get hostVerified — same as the main feed query so the badge is consistent
    const opp = db.prepare(
      'SELECT o.*, u.verified as hostVerified FROM opportunities o LEFT JOIN users u ON o.hostId = u.id WHERE o.id = ?'
    ).get(req.params.id) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
    const signups = db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(opp.id).map((s: any) => s.userId);
    return res.json(withTags(opp, signups));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Returns all posts belonging to the logged-in user (any status — including pending/denied)
router.get('/api/my-posts', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const posts = db.prepare(
      'SELECT * FROM opportunities WHERE hostId = ? ORDER BY createdAt DESC'
    ).all(req.userId!) as any[];
    const getSignups = db.prepare('SELECT userId FROM signups WHERE opportunityId = ?');
    const result = posts.map(opp =>
      withTags(opp, (getSignups.all(opp.id) as any[]).map((s: any) => s.userId))
    );
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Creating an opportunity requires being logged in as an org account (or admin)
router.post('/api/opportunities', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const { title, description, category, location, town, date, duration, spots, spotsType, image, tags, isRecurring, recurringDay, recurringTime, steps, externalSignupUrl, hasSignupPage } = req.body;
    if (!title || !description || !category || !location || !date || !duration || !image) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const locationError = getLocationError(location);
    if (locationError) return res.status(400).json({ error: locationError });
    // Town is required on NEW posts (existing rows stay null until backfilled)
    if (!town || !VALID_TOWNS.includes(town)) {
      return res.status(400).json({ error: 'Please select a town from the list' });
    }
    // Mirrors the create form's own check. Recurring posts skip this — their
    // date is server-computed as the next occurrence, always in the future.
    if (!isRecurring && new Date(date) <= new Date()) {
      return res.status(400).json({ error: 'Date must be in the future' });
    }
    // Length caps, enforced here because the form can be bypassed entirely
    for (const [field, value] of [['title', title], ['description', description], ['location', location]] as const) {
      const lengthError = getLengthError(field, value);
      if (lengthError) return res.status(400).json({ error: lengthError });
    }
    // At least one field, on new posts only. Not enforced on edit: posts that
    // predate this have none, and requiring it there would make every one of
    // them uneditable until someone picked a tag they were never asked for.
    if (!Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({ error: 'Pick at least one field for this post' });
    }
    if (Array.isArray(steps)) {
      if (steps.length > LIMITS.steps) {
        return res.status(400).json({ error: `Keep this to ${LIMITS.steps} steps or fewer` });
      }
      for (const s of steps) {
        if (typeof s !== 'string') return res.status(400).json({ error: 'Each step must be text' });
        const stepError = getLengthError('step', s);
        if (stepError) return res.status(400).json({ error: stepError });
      }
    }
    // Mirrors the create form's own gate: answering is required, a URL is
    // required only when the answer is yes. Enforced here too so the check
    // can't be skipped by calling the API directly.
    if (typeof hasSignupPage !== 'boolean') {
      return res.status(400).json({ error: 'Please answer yes or no' });
    }
    const trimmedSignupUrl = hasSignupPage && typeof externalSignupUrl === 'string' ? externalSignupUrl.trim() : '';
    if (hasSignupPage && !trimmedSignupUrl) {
      return res.status(400).json({ error: 'Add the link volunteers should register on' });
    }
    if (trimmedSignupUrl) {
      const signupUrlError = getExternalSignupUrlError(trimmedSignupUrl);
      if (signupUrlError) return res.status(400).json({ error: signupUrlError });
    }

    const hostId = req.userId!;
    const hostUser = db.prepare('SELECT username, accountType FROM users WHERE id = ?').get(hostId) as any;

    // Only organization accounts (or admins) can post opportunities
    if (!req.isAdmin && hostUser?.accountType !== 'organization') {
      return res.status(403).json({ error: 'Only organization accounts can create opportunities' });
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : []);
    const stepsJson = JSON.stringify(Array.isArray(steps) ? steps : []);
    const resolvedSpotsType = ['limited', 'unlimited', 'none'].includes(spotsType) ? spotsType : 'limited';
    const resolvedSpots = resolvedSpotsType === 'limited' ? (spots || 0) : 0;

    // Admins bypass the approval queue; org posts start as 'pending'
    const status = req.isAdmin ? 'approved' : 'pending';

    db.prepare(
      `INSERT INTO opportunities (id, title, description, category, location, town, date, duration, spots, spotsRemaining, spotsType, image, hostId, hostName, popularity, tags, steps, createdAt, isRecurring, recurringDay, recurringTime, status, externalSignupUrl, adultsOnly)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, title, description, category, location, town, date, duration, resolvedSpots, resolvedSpots, resolvedSpotsType, image || null, hostId, hostUser?.username || 'Unknown', tagsJson, stepsJson, createdAt, isRecurring ? 1 : 0, recurringDay ?? null, recurringTime ?? null, status, trimmedSignupUrl || null, req.body.adultsOnly ? 1 : 0);

    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as any;
    return res.status(201).json(withTags(opp, []));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== SIGNUPS =====

// "Interested" — uses userId from JWT. Spots are informational only (not decremented).
router.post('/api/opportunities/:id/signup', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.id;
    const userId = req.userId!;

    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    // The modal swaps the interest button for "This event has ended", but that
    // was the only thing stopping this — a direct call still registered
    // interest, and the org got a notification and an email about someone
    // joining an event that already happened. Recurring posts never end.
    if (!opp.isRecurring && new Date(opp.date) < new Date()) {
      return res.status(400).json({ error: 'This event has already ended' });
    }

    const existing = db.prepare('SELECT id FROM signups WHERE opportunityId = ? AND userId = ?').get(oppId, userId);
    if (existing) return res.status(409).json({ error: 'Already interested' });

    // 18+ events. There is only one sign-up step in this build (no separate
    // Commit), so this is the one place to check it — the moment someone is
    // actually telling the organization to expect them. Unknown age is NOT
    // treated as adult: accounts predating the birth-year field are let
    // through rather than blocked on a guess.
    if (opp.adultsOnly) {
      const me = db.prepare('SELECT birthYear FROM users WHERE id = ?').get(userId) as any;
      if (isMinor(me?.birthYear) === true) {
        return res.status(403).json({ error: 'This event is marked 18+ by the organization.' });
      }
    }

    // Spots are informational (capacity hint) — interest never blocks or consumes a spot.
    db.prepare('INSERT INTO signups (opportunityId, userId, createdAt) VALUES (?, ?, ?)').run(oppId, userId, new Date().toISOString());
    // Increment popularity
    db.prepare('UPDATE opportunities SET popularity = popularity + 1 WHERE id = ?').run(oppId);
    // Notify the host that someone is interested (only if host has opted in; skip own signups)
    if (opp.hostId !== userId) {
      const host = db.prepare('SELECT id, notifyOnInterest FROM users WHERE id = ?').get(opp.hostId) as any;
      if (host?.notifyOnInterest) {
        const volunteer = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
        const volunteerName = volunteer?.username || 'Someone';
        db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
          randomUUID(), opp.hostId, 'interest', `${volunteerName} is interested in "${opp.title}"`, oppId, new Date().toISOString()
        );
      }
    }

    // Send signup notification email to org host
    try {
      const hostForEmail = db.prepare('SELECT email, username FROM users WHERE id = ?').get(opp.hostId) as any;
      if (hostForEmail && opp.hostId !== userId) {
        const volUser = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
        await sendSignupNotificationEmail(hostForEmail.email, hostForEmail.username, volUser?.username || 'Someone', opp.title);
      }
    } catch { /* email errors are non-fatal */ }

    const updated = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    const signups = db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(oppId).map((s: any) => s.userId);
    return res.json(withTags(updated, signups));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/api/opportunities/:id/signup', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.id;
    const userId = req.userId!;

    const existing = db.prepare('SELECT id FROM signups WHERE opportunityId = ? AND userId = ?').get(oppId, userId);
    if (!existing) return res.status(404).json({ error: 'Not interested' });

    db.prepare('DELETE FROM signups WHERE opportunityId = ? AND userId = ?').run(oppId, userId);
    // Decrement popularity (floor at 0)
    db.prepare('UPDATE opportunities SET popularity = MAX(0, popularity - 1) WHERE id = ?').run(oppId);
    // Notify the host only if they have opted in to interest notifications
    const cancelOpp = db.prepare('SELECT title, hostId FROM opportunities WHERE id = ?').get(oppId) as any;
    if (cancelOpp && cancelOpp.hostId !== userId) {
      const host = db.prepare('SELECT notifyOnInterest FROM users WHERE id = ?').get(cancelOpp.hostId) as any;
      if (host?.notifyOnInterest) {
        const volunteer = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
        const volunteerName = volunteer?.username || 'Someone';
        db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
          randomUUID(), cancelOpp.hostId, 'cancel', `${volunteerName} removed interest from "${cancelOpp.title}"`, oppId, new Date().toISOString()
        );
      }
    }
    // Do NOT restore spotsRemaining — spots are informational only

    const updated = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    const signups = db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(oppId).map((s: any) => s.userId);
    return res.json(withTags(updated, signups));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// List interested volunteers for one opportunity — host (or admin) only.
// Returns real names/emails, so ownership is enforced server-side; the
// frontend button being host-gated is not a substitute for this check.
router.get('/api/opportunities/:id/interested', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.id;
    const opp = db.prepare('SELECT hostId FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
    if (opp.hostId !== req.userId && !req.isAdmin) {
      return res.status(403).json({ error: 'Only the host can view interested volunteers' });
    }

    const volunteers = db.prepare(
      `SELECT u.username, u.email, s.createdAt AS signedUpAt
       FROM signups s JOIN users u ON u.id = s.userId
       WHERE s.opportunityId = ?
       ORDER BY s.createdAt ASC`
    ).all(oppId) as { username: string; email: string; signedUpAt: string }[];

    return res.json(volunteers);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Edit own opportunity (host or admin)
router.put('/api/opportunities/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.id;
    const userId = req.userId!;

    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
    if (opp.hostId !== userId && !req.isAdmin) return res.status(403).json({ error: 'Not authorized to edit this opportunity' });

    const { title, description, category, location, town, date, duration, spots, spotsType, image, tags, steps, isAvailable, isRecurring, recurringDay, recurringTime, cardObjectPosition, modalObjectPosition, externalSignupUrl } = req.body;

    // --- Input validation ---
    if (spotsType !== undefined && !VALID_SPOTS_TYPES.includes(spotsType)) {
      return res.status(400).json({ error: `Invalid spotsType. Must be one of: ${VALID_SPOTS_TYPES.join(', ')}` });
    }
    if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
    }
    if (spots !== undefined && (typeof spots !== 'number' || spots < 0)) {
      return res.status(400).json({ error: 'spots must be a non-negative number' });
    }
    if (duration !== undefined && (typeof duration !== 'number' || duration <= 0)) {
      return res.status(400).json({ error: 'duration must be a positive number' });
    }
    if (recurringDay !== undefined) {
      const day = Number(recurringDay);
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        return res.status(400).json({ error: 'recurringDay must be an integer 0–6' });
      }
    }
    if (recurringTime !== undefined && !/^\d{2}:\d{2}$/.test(recurringTime)) {
      return res.status(400).json({ error: 'recurringTime must be in HH:MM format' });
    }
    if (location !== undefined) {
      const locationError = getLocationError(String(location));
      if (locationError) return res.status(400).json({ error: locationError });
    }
    // Town stays optional on edits — pre-existing posts may be townless until backfilled
    if (town !== undefined && town !== null && town !== '' && !VALID_TOWNS.includes(town)) {
      return res.status(400).json({ error: `Invalid town. Must be one of: ${VALID_TOWNS.join(', ')}` });
    }
    // Same length caps the create route enforces — the edit form can be bypassed too
    for (const [field, value] of [['title', title], ['description', description], ['location', location]] as const) {
      if (value === undefined) continue;
      const lengthError = getLengthError(field, value);
      if (lengthError) return res.status(400).json({ error: lengthError });
    }
    // Never required — validated only when a non-blank value was sent; a blank value clears it to null
    let trimmedSignupUrl: string | undefined;
    // steps were accepted on create but never on edit, so an organization that
    // put its registration link in the wrong place -- or simply mistyped it --
    // had no way of correcting it. Same limits create applies.
    if (steps !== undefined) {
      if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps must be a list' });
      if (steps.length > LIMITS.steps) {
        return res.status(400).json({ error: `Keep this to ${LIMITS.steps} steps or fewer` });
      }
      for (const st of steps) {
        // Explicit, because getLengthError only inspects strings -- a number
        // or object slipped straight through it, was stored as JSON, and then
        // reached a renderer that calls .split on it.
        if (typeof st !== 'string') return res.status(400).json({ error: 'Each step must be text' });
        const stepError = getLengthError('step', st);
        if (stepError) return res.status(400).json({ error: stepError });
      }
    }
    if (externalSignupUrl !== undefined) {
      trimmedSignupUrl = typeof externalSignupUrl === 'string' ? externalSignupUrl.trim() : '';
      if (trimmedSignupUrl) {
        const signupUrlError = getExternalSignupUrlError(trimmedSignupUrl);
        if (signupUrlError) return res.status(400).json({ error: signupUrlError });
      }
    }

    // --- Apply updates (all inside a transaction so they're atomic) ---
    db.transaction(() => {
      if (title       !== undefined) db.prepare('UPDATE opportunities SET title = ? WHERE id = ?').run(String(title).trim(), oppId);
      if (description !== undefined) db.prepare('UPDATE opportunities SET description = ? WHERE id = ?').run(String(description).trim(), oppId);
      if (category    !== undefined) db.prepare('UPDATE opportunities SET category = ? WHERE id = ?').run(category, oppId);
      if (location    !== undefined) db.prepare('UPDATE opportunities SET location = ? WHERE id = ?').run(String(location).trim(), oppId);
      if (town        !== undefined) db.prepare('UPDATE opportunities SET town = ? WHERE id = ?').run(town || null, oppId);
      if (date        !== undefined) db.prepare('UPDATE opportunities SET date = ? WHERE id = ?').run(date, oppId);
      if (duration    !== undefined) db.prepare('UPDATE opportunities SET duration = ? WHERE id = ?').run(duration, oppId);
      if (image       !== undefined) db.prepare('UPDATE opportunities SET image = ? WHERE id = ?').run(image || null, oppId);
      if (tags        !== undefined) db.prepare('UPDATE opportunities SET tags = ? WHERE id = ?').run(JSON.stringify(Array.isArray(tags) ? tags : []), oppId);
      if (spotsType   !== undefined) db.prepare('UPDATE opportunities SET spotsType = ? WHERE id = ?').run(spotsType, oppId);
      if (spots       !== undefined) db.prepare('UPDATE opportunities SET spots = ?, spotsRemaining = ? WHERE id = ?').run(spots, spots, oppId);
      if (isAvailable !== undefined) db.prepare('UPDATE opportunities SET isAvailable = ? WHERE id = ?').run(isAvailable ? 1 : 0, oppId);
      if (req.body.adultsOnly !== undefined) db.prepare('UPDATE opportunities SET adultsOnly = ? WHERE id = ?').run(req.body.adultsOnly ? 1 : 0, oppId);
      if (isRecurring !== undefined) db.prepare('UPDATE opportunities SET isRecurring = ? WHERE id = ?').run(isRecurring ? 1 : 0, oppId);
      if (recurringDay   !== undefined) db.prepare('UPDATE opportunities SET recurringDay = ? WHERE id = ?').run(Number(recurringDay), oppId);
      if (recurringTime  !== undefined) db.prepare('UPDATE opportunities SET recurringTime = ? WHERE id = ?').run(recurringTime, oppId);
      if (cardObjectPosition  !== undefined) db.prepare('UPDATE opportunities SET cardObjectPosition = ? WHERE id = ?').run(cardObjectPosition || null, oppId);
      if (modalObjectPosition !== undefined) db.prepare('UPDATE opportunities SET modalObjectPosition = ? WHERE id = ?').run(modalObjectPosition || null, oppId);
      if (trimmedSignupUrl    !== undefined) db.prepare('UPDATE opportunities SET externalSignupUrl = ? WHERE id = ?').run(trimmedSignupUrl || null, oppId);
      if (steps                !== undefined) db.prepare('UPDATE opportunities SET steps = ? WHERE id = ?').run(JSON.stringify(steps), oppId);
    })();

    const updated = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    const signups = db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(oppId).map((s: any) => s.userId);
    return res.json(withTags(updated, signups));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete own opportunity (host or admin)
router.delete('/api/opportunities/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.id;
    const userId = req.userId!;

    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
    if (opp.hostId !== userId && !req.isAdmin) return res.status(403).json({ error: 'Not authorized to delete this opportunity' });

    // Email all signed-up volunteers that the event is cancelled
    try {
      const signedUpUsers = db.prepare(
        'SELECT u.email, u.username FROM signups s JOIN users u ON u.id = s.userId WHERE s.opportunityId = ?'
      ).all(oppId) as any[];
      const hostUser = db.prepare('SELECT username FROM users WHERE id = ?').get(opp.hostId) as any;
      for (const vol of signedUpUsers) {
        await sendEventCancelledEmail(vol.email, vol.username, opp.title, hostUser?.username || 'the organizer');
      }
    } catch { /* non-fatal */ }

    db.transaction(() => {
      db.prepare('DELETE FROM signups WHERE opportunityId = ?').run(oppId);
      db.prepare('DELETE FROM reports WHERE postId = ?').run(oppId);
      db.prepare('DELETE FROM opportunities WHERE id = ?').run(oppId);
    })();
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== FAVORITES =====

// Get all favorited orgs for the current user
router.get('/api/favorites', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    // No email column. Nothing on the client has ever displayed it -- the
    // favourites list renders a name and an avatar letter -- so it was only
    // ever an address sitting in a response waiting to be read.
    const favorites = db.prepare(`
      SELECT u.id, u.username, u.accountType, u.createdAt
      FROM favorites f
      JOIN users u ON f.orgId = u.id
      WHERE f.userId = ? AND u.accountType = 'organization'
      ORDER BY f.createdAt DESC
    `).all(userId);
    return res.json(favorites);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Add a favorite org
router.post('/api/favorites/:orgId', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { orgId } = req.params;
    if (userId === orgId) return res.status(400).json({ error: 'Cannot favorite yourself' });

    // Must actually be an organization. Checking only that the row exists let
    // any account favourite a *volunteer* -- and since the read below joins the
    // users table, that turned this into a way to look up another volunteer's
    // email address. The ids to feed it were public on the board.
    const org = db.prepare(
      "SELECT id FROM users WHERE id = ? AND accountType = 'organization'"
    ).get(orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const existing = db.prepare('SELECT 1 FROM favorites WHERE userId = ? AND orgId = ?').get(userId, orgId);
    if (existing) return res.status(409).json({ error: 'Already favorited' });

    db.prepare('INSERT INTO favorites (userId, orgId, createdAt) VALUES (?, ?, ?)').run(userId, orgId, new Date().toISOString());
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Remove a favorite org
router.delete('/api/favorites/:orgId', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { orgId } = req.params;

    const existing = db.prepare('SELECT 1 FROM favorites WHERE userId = ? AND orgId = ?').get(userId, orgId);
    if (!existing) return res.status(404).json({ error: 'Not favorited' });

    db.prepare('DELETE FROM favorites WHERE userId = ? AND orgId = ?').run(userId, orgId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== ADMIN =====
// All admin routes are protected by requireAdmin middleware — admin identity comes from JWT

router.get('/api/admin/users', requireAdmin, (_req: Request, res: Response) => {
  try {
    // Onboarding columns included so admins can see what a volunteer said they
    // want -- onboardingFields() parses them the same way every other
    // user-facing response does, rather than a second ad-hoc shape here.
    const users = db.prepare(
      `SELECT id, username, email, isAdmin, accountType, banned, verified, createdAt,
              onboardingHoursSoFar, onboardingInterests, onboardingMajors,
              onboardingGoalHours, onboardingGoalEvents, onboardingTowns,
              onboardingAvailability, onboardingCompletedAt
       FROM users ORDER BY createdAt DESC`
    ).all();
    return res.json((users as any[]).map(u => ({
      ...u, isAdmin: !!u.isAdmin, banned: !!u.banned, verified: !!u.verified,
      ...onboardingFields(u),
    })));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/api/admin/users/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.id;
    if (userId === req.userId) {
      return res.status(400).json({ error: 'Cannot delete your own admin account' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    // Clean up everything owned by this user — all inside a transaction so it's atomic
    db.transaction(() => {
      // 0. Email verification and password-reset tokens (FK → users; must go first)
      db.prepare('DELETE FROM email_verifications WHERE userId = ?').run(userId);
      db.prepare('DELETE FROM password_resets WHERE userId = ?').run(userId);
      // 1. Their signups on other events
      db.prepare('DELETE FROM signups WHERE userId = ?').run(userId);
      // 2. All signups and reports ON their hosted events (before deleting the events themselves)
      const hostedIds = (db.prepare('SELECT id FROM opportunities WHERE hostId = ?').all(userId) as any[]).map((o: any) => o.id);
      for (const oppId of hostedIds) {
        db.prepare('DELETE FROM signups WHERE opportunityId = ?').run(oppId);
        db.prepare('DELETE FROM reports WHERE postId = ?').run(oppId);
      }
      // 3. Their hosted opportunities
      db.prepare('DELETE FROM opportunities WHERE hostId = ?').run(userId);
      // 4. Their notifications
      db.prepare('DELETE FROM notifications WHERE userId = ?').run(userId);
      // 5. Their favorites (as the favoriter) and others who favorited them (if they were an org)
      db.prepare('DELETE FROM favorites WHERE userId = ?').run(userId);
      db.prepare('DELETE FROM favorites WHERE orgId = ?').run(userId);
      // 6. Their pending appeals
      db.prepare('DELETE FROM appeals WHERE userId = ?').run(userId);
      // 7. Reports they filed
      db.prepare('DELETE FROM reports WHERE reporterId = ?').run(userId);
      // 8. Anonymise feedback — preserve the rating/message data but remove the user link
      db.prepare('UPDATE feedback SET userId = NULL WHERE userId = ?').run(userId);
      // 9. The user record itself
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    })();
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/api/admin/opportunities/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const oppId = req.params.id;
    const { title, description, category, location, town, date, duration, spots, spotsRemaining, adminReason, pinnedSize, externalSignupUrl } = req.body;

    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    // --- Input validation ---
    if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
    }
    if (spots !== undefined && (typeof spots !== 'number' || spots < 0)) {
      return res.status(400).json({ error: 'spots must be a non-negative number' });
    }
    if (spotsRemaining !== undefined && (typeof spotsRemaining !== 'number' || spotsRemaining < 0)) {
      return res.status(400).json({ error: 'spotsRemaining must be a non-negative number' });
    }
    if (duration !== undefined && (typeof duration !== 'number' || duration <= 0)) {
      return res.status(400).json({ error: 'duration must be a positive number' });
    }
    if (pinnedSize !== undefined && pinnedSize !== null && !VALID_PINNED_SIZES.includes(pinnedSize)) {
      return res.status(400).json({ error: `Invalid pinnedSize. Must be one of: ${VALID_PINNED_SIZES.join(', ')}, or null` });
    }
    // Town stays optional on edits — pre-existing posts may be townless until backfilled
    if (town !== undefined && town !== null && town !== '' && !VALID_TOWNS.includes(town)) {
      return res.status(400).json({ error: `Invalid town. Must be one of: ${VALID_TOWNS.join(', ')}` });
    }
    // Never required — validated only when a non-blank value was sent; a blank value clears it to null
    let trimmedSignupUrl: string | undefined;
    if (externalSignupUrl !== undefined) {
      trimmedSignupUrl = typeof externalSignupUrl === 'string' ? externalSignupUrl.trim() : '';
      if (trimmedSignupUrl) {
        const signupUrlError = getExternalSignupUrlError(trimmedSignupUrl);
        if (signupUrlError) return res.status(400).json({ error: signupUrlError });
      }
    }

    if (title !== undefined) db.prepare('UPDATE opportunities SET title = ? WHERE id = ?').run(String(title).trim(), oppId);
    if (description !== undefined) db.prepare('UPDATE opportunities SET description = ? WHERE id = ?').run(String(description).trim(), oppId);
    if (category !== undefined) db.prepare('UPDATE opportunities SET category = ? WHERE id = ?').run(category, oppId);
    if (location !== undefined) db.prepare('UPDATE opportunities SET location = ? WHERE id = ?').run(String(location).trim(), oppId);
    if (town !== undefined) db.prepare('UPDATE opportunities SET town = ? WHERE id = ?').run(town || null, oppId);
    if (date !== undefined) db.prepare('UPDATE opportunities SET date = ? WHERE id = ?').run(date, oppId);
    if (duration !== undefined) db.prepare('UPDATE opportunities SET duration = ? WHERE id = ?').run(duration, oppId);
    if (spots !== undefined) db.prepare('UPDATE opportunities SET spots = ? WHERE id = ?').run(spots, oppId);
    if (spotsRemaining !== undefined) db.prepare('UPDATE opportunities SET spotsRemaining = ? WHERE id = ?').run(spotsRemaining, oppId);
    // pinnedSize: admin-only card size override ('small' | 'medium' | 'large' | null = auto)
    if (pinnedSize !== undefined) {
      db.prepare('UPDATE opportunities SET pinnedSize = ? WHERE id = ?').run(pinnedSize, oppId);
    }
    if (trimmedSignupUrl !== undefined) {
      db.prepare('UPDATE opportunities SET externalSignupUrl = ? WHERE id = ?').run(trimmedSignupUrl || null, oppId);
    }

    // Notify host if a reason was provided
    if (adminReason?.trim() && opp.hostId) {
      const hostExists = db.prepare('SELECT id FROM users WHERE id = ?').get(opp.hostId);
      if (hostExists) {
        const postTitle = title ?? opp.title;
        const msg = `An admin edited your post "${postTitle}". Reason: ${adminReason.trim()}`;
        db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)')
          .run(randomUUID(), opp.hostId, 'admin_edit', msg, oppId, new Date().toISOString());
      }
    }

    const updated = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    const signups = db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(oppId).map((s: any) => s.userId);
    return res.json(withTags(updated, signups));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/api/admin/opportunities/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const oppId = req.params.id;
    const { reason } = req.body || {};

    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    // Notify host before deleting (always notify, reason is optional)
    if (opp.hostId) {
      const hostExists = db.prepare('SELECT id FROM users WHERE id = ?').get(opp.hostId);
      if (hostExists) {
        const msg = reason?.trim()
          ? `Your post "${opp.title}" was removed by an admin. Reason: ${reason.trim()}`
          : `Your post "${opp.title}" was removed by an admin.`;
        db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)')
          .run(randomUUID(), opp.hostId, 'admin_delete', msg, null, new Date().toISOString());
      }
    }

    // Admin removal is the moderation escape hatch, so unlike the
    // organization's own delete it proceeds unconditionally.
    db.transaction(() => {
      db.prepare('DELETE FROM signups WHERE opportunityId = ?').run(oppId);
      db.prepare('DELETE FROM reports WHERE postId = ?').run(oppId);
      db.prepare('DELETE FROM opportunities WHERE id = ?').run(oppId);
    })();
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/users/:id/ban', requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.id;
    if (userId === req.userId) return res.status(400).json({ error: 'Cannot ban yourself' });
    const user = db.prepare('SELECT id, isAdmin FROM users WHERE id = ?').get(userId) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isAdmin) return res.status(400).json({ error: 'Cannot ban an admin account' });
    db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(userId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/users/:id/unban', requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.id;
    db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(userId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== POST APPROVAL =====

// List all pending opportunities
router.get('/api/admin/pending-opportunities', requireAdmin, (_req: Request, res: Response) => {
  try {
    const pending = db.prepare(
      "SELECT * FROM opportunities WHERE status = 'pending' ORDER BY createdAt ASC"
    ).all();
    const getSignups = db.prepare('SELECT userId FROM signups WHERE opportunityId = ?');
    const result = (pending as any[]).map(opp =>
      withTags(opp, (getSignups.all(opp.id) as any[]).map((s: any) => s.userId))
    );
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Approve a pending opportunity
router.post('/api/admin/opportunities/:id/approve', requireAdmin, async (req: Request, res: Response) => {
  try {
    const oppId = req.params.id;
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    db.prepare("UPDATE opportunities SET status = 'approved' WHERE id = ?").run(oppId);

    // Notify the host
    if (opp.hostId) {
      const hostExists = db.prepare('SELECT id FROM users WHERE id = ?').get(opp.hostId);
      if (hostExists) {
        db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)')
          .run(randomUUID(), opp.hostId, 'post_approved', `Your post "${opp.title}" has been approved and is now live!`, oppId, new Date().toISOString());
      }
    }

    try {
      const host = db.prepare('SELECT email, username FROM users WHERE id = ?').get(opp.hostId) as any;
      if (host) await sendPostApprovedEmail(host.email, host.username, opp.title);
    } catch (err: any) {
      // Non-fatal, but must be visible in logs — a silent Brevo failure means
      // the org never learns their post went live.
      console.error(`[email] post-approved send failed for host ${opp.hostId} (post "${opp.title}"):`, err?.message ?? err);
    }

    const updated = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    const signups = db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(oppId).map((s: any) => s.userId);
    return res.json(withTags(updated, signups));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Deny a pending opportunity (sets status to 'denied' and notifies the host with optional reason)
router.post('/api/admin/opportunities/:id/deny', requireAdmin, async (req: Request, res: Response) => {
  try {
    const oppId = req.params.id;
    const { reason } = req.body || {};
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    db.prepare("UPDATE opportunities SET status = 'denied' WHERE id = ?").run(oppId);

    // Notify the host
    if (opp.hostId) {
      const hostExists = db.prepare('SELECT id FROM users WHERE id = ?').get(opp.hostId);
      if (hostExists) {
        const msg = reason?.trim()
          ? `Your post "${opp.title}" was not approved. Reason: ${reason.trim()}`
          : `Your post "${opp.title}" was not approved by an admin.`;
        db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)')
          .run(randomUUID(), opp.hostId, 'post_denied', msg, oppId, new Date().toISOString());
      }
    }

    try {
      const host = db.prepare('SELECT email, username FROM users WHERE id = ?').get(opp.hostId) as any;
      if (host) await sendPostDeniedEmail(host.email, host.username, opp.title, reason);
    } catch { /* non-fatal */ }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Daily signup/new-user counts behind the Overview chart. Lost in the same
// cleanup that took /api/admin/stats, and just as quiet about it: the client
// does `r.ok ? r.json() : []`, so a missing route reaches the chart as an
// empty array and renders "No data for this period" — which is exactly what a
// genuinely quiet fortnight looks like.
// Who still hasn't done the questionnaire. Read-only, so the admin can see the
// number before deciding to send anything.
/** How long before the same person can be nudged again. */
const NUDGE_COOLDOWN_DAYS = 7;

/** ISO cutoff for the cooldown. Computed here rather than in SQL on purpose:
 *  every timestamp in this database is a JS toISOString(), which SQLite's own
 *  datetime('now') does not match, so a SQL-side comparison would quietly
 *  compare two different formats. */
function nudgeCutoff(): string {
  return new Date(Date.now() - NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Who a nudge is for: every volunteer who has not answered the questionnaire
 * and has not been contacted inside the cooldown.
 *
 * The cooldown replaces what used to be `onboardingNudgedAt IS NULL`. That
 * excluded anyone nudged even once, forever -- which is why the button
 * eventually reported nothing to send and did nothing when pressed. But the
 * stamp still has to gate something, because it is also what makes a failed
 * run resumable: a Brevo outage leaves those people unstamped, and pressing
 * again picks up exactly them instead of re-emailing everyone who already
 * succeeded. A time window keeps that property and still lets a second round
 * go out later. Takes the cutoff as a bound parameter.
 */
const NUDGE_TARGETS = `
  FROM users
  WHERE accountType = 'volunteer'
    AND onboardingCompletedAt IS NULL
    AND banned = 0
    AND email NOT LIKE '%@example.com'
    AND (onboardingNudgedAt IS NULL OR onboardingNudgedAt < ?)
`;

// Nudge one person, rather than the whole cohort. Same two channels as the
// bulk action: an email, or the in-site notification.
router.post('/api/admin/users/:id/nudge', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { channel, message } = req.body as { channel?: string; message?: string };
    if (channel !== 'email' && channel !== 'notification') {
      return res.status(400).json({ error: "channel must be 'email' or 'notification'" });
    }
    const u = db.prepare(
      `SELECT id, username, email, accountType, banned, emailVerified, emailReminders,
              unsubToken, onboardingCompletedAt
       FROM users WHERE id = ?`
    ).get(req.params.id) as any;
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.banned) return res.status(400).json({ error: 'That account is suspended' });
    // The admin UI already hides these buttons for accounts they make no sense
    // for, but that was the only thing enforcing it -- the route itself would
    // happily email an organization the volunteer questionnaire.
    if (u.accountType !== 'volunteer') {
      return res.status(400).json({ error: 'The questionnaire is for volunteer accounts' });
    }
    if (u.onboardingCompletedAt) {
      return res.status(400).json({ error: 'They have already answered the questionnaire' });
    }

    const now = new Date().toISOString();

    if (channel === 'notification') {
      // A blank message means the questionnaire nudge, which is the common
      // case; anything typed is sent verbatim. The questionnaire one reuses
      // the fixed id so it can't stack up with the bulk send's copy, but a
      // written message is its own notification and always goes through.
      //
      // Typed messages are onboarding_reminder too, not admin_message. This
      // button exists to ask someone about the questionnaire, so whatever the
      // wording, tapping it should open the questionnaire -- as admin_message
      // it was a dead end that marked itself read and did nothing else.
      const custom = (message || '').trim().slice(0, MAX_ONBOARDING_TEXT);
      if (custom) {
        db.prepare(
          'INSERT INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)'
        ).run(randomUUID(), u.id, 'onboarding_reminder', custom, now);
      } else {
        db.prepare(
          'INSERT OR IGNORE INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)'
        ).run(
          `onboarding-reminder-${u.id}`, u.id, 'onboarding_reminder',
          'We added a short questionnaire — it takes a minute and lets us mark the opportunities that actually fit you.',
          now
        );
      }
      return res.json({ sent: true, channel });
    }

    // channel === 'email'
    if (String(u.email).endsWith('@example.com')) {
      return res.status(400).json({ error: 'That is a placeholder address' });
    }
    // Unsubscribing is the one thing a single-user send still will not
    // override. Everything else here is a judgement the admin is entitled to
    // make one person at a time; this one is the recipient's.
    if (u.emailVerified && !u.emailReminders) {
      return res.status(400).json({ error: 'They have unsubscribed from emails' });
    }
    try {
      if (u.emailVerified) {
        await sendOnboardingNudgeEmail(u.email, u.username, u.unsubToken || '', true);
      } else {
        // Same reasoning as the bulk send: the survey link needs a session
        // they have never been able to get. Ask for the confirmation instead.
        await sendVerifyThenSurveyEmail(u.email, u.username, mintVerificationToken(u.id));
      }
    } catch {
      return res.status(502).json({ error: "Couldn't send — the mail provider rejected it" });
    }
    // Stamped so the bulk send leaves them alone for the cooldown.
    db.prepare('UPDATE users SET onboardingNudgedAt = ? WHERE id = ?').run(now, u.id);
    return res.json({ sent: true, channel, kind: u.emailVerified ? 'questionnaire' : 'verification' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/admin/onboarding-nudge', requireAdmin, (_req: Request, res: Response) => {
  try {
    const cutoff = nudgeCutoff();
    const count = (extra = '', ...args: any[]) =>
      (db.prepare(`SELECT COUNT(*) as c ${NUDGE_TARGETS} ${extra}`).get(cutoff, ...args) as any).c;

    const pending = count();
    // The three ways a target is handled, made mutually exclusive so the
    // breakdown always adds up to `pending`. Order matters: a placeholder
    // address is checked first, then never-confirmed, then unsubscribed, so
    // nobody lands in two buckets at once the way they used to.
    const unverifiedEmail = count('AND emailVerified = 0');
    const unsubscribed = count('AND emailVerified = 1 AND emailReminders = 0');
    // Everyone left gets the questionnaire email.
    const emailable = count('AND emailVerified = 1 AND emailReminders = 1');

    // Still-outstanding only. Counting people who have since answered made the
    // card promise they would be asked again after the cooldown, which is not
    // true -- answering removes them for good.
    const alreadyNudged = (db.prepare(
      `SELECT COUNT(*) as c FROM users
       WHERE accountType='volunteer' AND onboardingNudgedAt IS NOT NULL
         AND onboardingCompletedAt IS NULL AND banned = 0`
    ).get() as any).c;

    // Named, not just counted. The owner has to decide case by case whether to
    // reach these two some other way, and "2 unsubscribed" does not let them.
    const unsubscribedNames = (db.prepare(
      `SELECT username, email ${NUDGE_TARGETS}
         AND emailVerified = 1 AND emailReminders = 0
       ORDER BY username LIMIT 25`
    ).all(cutoff) as any[]).map(u => ({ username: u.username, email: u.email }));

    return res.json({
      pending,
      emailable,
      verificationEmailable: unverifiedEmail,
      alreadyNudged,
      cooldownDays: NUDGE_COOLDOWN_DAYS,
      skipped: { unverifiedEmail, unsubscribed },
      unsubscribedNames,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// One nudge run at a time. The route awaits Brevo once per recipient, so a
// run takes as long as the mailing does; a proxy timeout in front of it shows
// the admin an error even when the send is still going fine, and the obvious
// reaction is to press again. The targets are selected before the first await,
// so testing and setting this is atomic in a single-process server.
let nudgeRunning = false;

router.post('/api/admin/onboarding-nudge', requireAdmin, async (_req: Request, res: Response) => {
  if (nudgeRunning) {
    return res.status(409).json({ error: 'A nudge is already being sent. Give it a moment.' });
  }
  nudgeRunning = true;
  try {
    const cutoff = nudgeCutoff();
    const targets = db.prepare(
      `SELECT id, username, email, emailVerified, emailReminders, unsubToken ${NUDGE_TARGETS}`
    ).all(cutoff) as any[];

    const now = new Date().toISOString();
    // Upsert, not INSERT OR IGNORE. The id is one per user, so the row usually
    // already exists -- from an earlier nudge, or from skipping the
    // questionnaire, which writes the same id. Ignoring the conflict meant a
    // repeat nudge wrote nothing at all: no unread badge, no new timestamp,
    // nothing the volunteer could notice, while the response still reported
    // every target as notified. Re-arming read and createdAt is what actually
    // puts it back at the top of the bell.
    const notify = db.prepare(
      `INSERT INTO notifications (id, userId, type, message, read, createdAt)
       VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         message = excluded.message, read = 0, createdAt = excluded.createdAt`
    );
    const markNudged = db.prepare('UPDATE users SET onboardingNudgedAt = ? WHERE id = ?');

    const isPlaceholder = (u: any) => String(u.email).endsWith('@example.com');
    const wantsQuestionnaire = (u: any) => !isPlaceholder(u) && u.emailVerified && u.emailReminders;
    const wantsVerification = (u: any) => !isPlaceholder(u) && !u.emailVerified;

    // The in-site notification is free and goes to everyone, every run.
    db.transaction(() => {
      for (const u of targets) {
        notify.run(
          `onboarding-reminder-${u.id}`, u.id, 'onboarding_reminder',
          'We added a short questionnaire — it takes a minute and lets us mark the opportunities that actually fit you.',
          now
        );
        // Someone who gets no email is finished with as soon as the
        // notification is written -- but only if they can actually reach it.
        // An unverified account cannot log in, so its bell is unreachable;
        // those people are stamped further down, when their email goes out.
        if (!wantsQuestionnaire(u) && !wantsVerification(u) && u.emailVerified) {
          markNudged.run(now, u.id);
        }
      }
    })();

    // Stamped only once the email is actually away. The stamp is what holds
    // someone out for the cooldown, so stamping before the attempt would mean
    // a Brevo outage silently skipped them for a week. This way a failure
    // leaves them selectable and pressing again picks up exactly them.
    let emailedQuestionnaire = 0, emailedVerification = 0, emailFailed = 0;
    let skippedUnsubscribed = 0;
    for (const u of targets) {
      if (isPlaceholder(u)) continue;
      if (wantsQuestionnaire(u)) {
        try {
          await sendOnboardingNudgeEmail(u.email, u.username, u.unsubToken || '');
          markNudged.run(now, u.id);
          emailedQuestionnaire++;
        } catch { emailFailed++; }
      } else if (wantsVerification(u)) {
        // They never confirmed, so the survey link would only ever show them a
        // login they cannot pass. Ask for the confirmation instead -- it is the
        // one thing that unsticks the account, and the questionnaire is waiting
        // on the other side of it.
        try {
          const token = mintVerificationToken(u.id);
          await sendVerifyThenSurveyEmail(u.email, u.username, token);
          markNudged.run(now, u.id);
          emailedVerification++;
        } catch { emailFailed++; }
      } else {
        skippedUnsubscribed++;
      }
    }

    return res.json({
      notified: targets.length,
      emailedQuestionnaire,
      emailedVerification,
      skippedUnsubscribed,
      emailFailed,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  } finally {
    nudgeRunning = false;
  }
});

router.get('/api/admin/analytics', requireAdmin, (req: Request, res: Response) => {
  try {
    const ALLOWED_DAYS = [7, 14, 30, 365];
    const requested = parseInt(req.query.days as string, 10);
    const numDays = ALLOWED_DAYS.includes(requested) ? requested : 14;

    const start = new Date();
    start.setDate(start.getDate() - (numDays - 1));
    const startStr = start.toISOString().slice(0, 10);

    // One grouped query per table. The original counted with two queries per
    // day, which is 730 round trips for the 1Y view to get what GROUP BY
    // returns in one.
    const toMap = (rows: unknown) =>
      new Map((rows as { d: string; c: number }[]).map(r => [r.d, r.c]));
    const signupsByDay = toMap(
      db.prepare('SELECT date(createdAt) AS d, COUNT(*) AS c FROM signups WHERE date(createdAt) >= ? GROUP BY d').all(startStr)
    );
    const usersByDay = toMap(
      db.prepare('SELECT date(createdAt) AS d, COUNT(*) AS c FROM users WHERE date(createdAt) >= ? GROUP BY d').all(startStr)
    );

    const days: { date: string; signups: number; users: number }[] = [];
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({ date: dateStr, signups: signupsByDay.get(dateStr) ?? 0, users: usersByDay.get(dateStr) ?? 0 });
    }
    return res.json(days);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/admin/stats', requireAdmin, (_req: Request, res: Response) => {
  try {
    const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
    const totalOpps = (db.prepare("SELECT COUNT(*) as count FROM opportunities WHERE status = 'approved'").get() as any).count;
    const totalSignups = (db.prepare('SELECT COUNT(*) as count FROM signups').get() as any).count;
    return res.json({ totalUsers, totalOpps, totalSignups });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== NOTIFICATIONS =====

router.get('/api/notifications', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const notifications = db.prepare(
      'SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 50'
    ).all(req.userId!);
    return res.json((notifications as any[]).map(n => ({ ...n, read: !!n.read })));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/notifications/read-all', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    db.prepare('UPDATE notifications SET read = 1 WHERE userId = ?').run(req.userId!);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/notifications/:id/read', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND userId = ?').run(req.params.id, req.userId!);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== REPORTS =====

router.post('/api/reports', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const { postId, reason, note } = req.body;
    if (!postId || !reason) return res.status(400).json({ error: 'Missing required fields' });

    const post = db.prepare('SELECT title FROM opportunities WHERE id = ?').get(postId) as any;
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const reporter = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId!) as any;

    // Prevent duplicate reports from same user for same post
    const existing = db.prepare('SELECT id FROM reports WHERE postId = ? AND reporterId = ?').get(postId, req.userId!);
    if (existing) return res.status(409).json({ error: 'You already reported this post' });

    db.prepare(
      'INSERT INTO reports (id, postId, postTitle, reporterId, reporterName, reason, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), postId, post.title, req.userId!, reporter?.username || 'Unknown', reason, note || null, new Date().toISOString());

    return res.status(201).json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/admin/reports', requireAdmin, (_req: Request, res: Response) => {
  try {
    const reports = db.prepare('SELECT * FROM reports ORDER BY createdAt DESC').all();
    return res.json(reports);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/api/admin/reports/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== FEEDBACK =====

// optionalAuth is applied so authenticated users are identified from their token.
// Body-supplied userId/username are ignored — anonymous feedback is intentional, spoofed identity isn't.
router.post('/api/feedback', optionalAuth, (req: AuthRequest, res: Response) => {
  try {
    const { rating, message } = req.body;
    if (!rating || !message) return res.status(400).json({ error: 'Rating and message are required' });
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1–5' });

    // Derive identity from the JWT if authenticated; otherwise store as anonymous
    let feedbackUserId: string | null = null;
    let feedbackUsername: string | null = null;
    if (req.userId) {
      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId) as any;
      feedbackUserId = req.userId;
      feedbackUsername = user?.username || null;
    }

    db.prepare(
      'INSERT INTO feedback (id, userId, username, rating, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), feedbackUserId, feedbackUsername, rating, message, new Date().toISOString());

    return res.status(201).json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/admin/feedback', requireAdmin, (_req: Request, res: Response) => {
  try {
    const feedback = db.prepare('SELECT * FROM feedback ORDER BY createdAt DESC').all();
    return res.json(feedback);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/api/admin/feedback/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== APPEALS =====

// Submit a ban appeal (no auth required — suspended users can't log in)
router.post('/api/appeals', (req: Request, res: Response) => {
  try {
    const { email, message } = req.body;
    if (!email || !message?.trim()) return res.status(400).json({ error: 'Email and message are required' });

    const user = db.prepare('SELECT id, username, email, banned FROM users WHERE email = ?').get(email) as any;
    if (!user) return res.status(404).json({ error: 'No account found with that email' });
    if (!user.banned) return res.status(400).json({ error: 'Account is not suspended' });

    // Prevent duplicate pending appeals
    const existing = db.prepare("SELECT id FROM appeals WHERE userId = ? AND status = 'pending'").get(user.id);
    if (existing) return res.status(409).json({ error: 'You already have a pending appeal' });

    db.prepare(
      'INSERT INTO appeals (id, userId, username, email, message, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(randomUUID(), user.id, user.username, user.email, message.trim(), 'pending', new Date().toISOString());

    return res.status(201).json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: list all pending appeals
router.get('/api/admin/appeals', requireAdmin, (_req: Request, res: Response) => {
  try {
    const appeals = db.prepare("SELECT * FROM appeals WHERE status = 'pending' ORDER BY createdAt DESC").all();
    return res.json(appeals);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: approve appeal → unban user
router.post('/api/admin/appeals/:id/approve', requireAdmin, (req: Request, res: Response) => {
  try {
    const appeal = db.prepare('SELECT * FROM appeals WHERE id = ?').get(req.params.id) as any;
    if (!appeal) return res.status(404).json({ error: 'Appeal not found' });

    db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(appeal.userId);
    db.prepare("UPDATE appeals SET status = 'approved' WHERE id = ?").run(req.params.id);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin: dismiss appeal
router.delete('/api/admin/appeals/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    db.prepare("UPDATE appeals SET status = 'dismissed' WHERE id = ?").run(req.params.id);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== IMAGE UPLOAD =====

router.post('/api/upload', requireAuth, upload.single('image'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // The declared type got it this far; the bytes decide whether it stays.
  // Anyone can put "image/png" on a request header, so without this the
  // extension we chose above would simply be a lie wrapped around a script.
  if (!looksLikeRealImage(req.file.path)) {
    try { fs.unlinkSync(req.file.path); } catch { /* nothing to clean up */ }
    return res.status(400).json({ error: "That file isn't a JPG, PNG, GIF or WebP image" });
  }
  return res.json({ url: `/uploads/${req.file.filename}` });
});

/** Turns multer's own failures into a message someone can act on.
 *  Without this they reached the global handler as a bare 500. */
router.use('/api/upload', (err: any, _req: Request, res: Response, next: NextFunction) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'That image is over the 5 MB limit' });
  }
  return res.status(400).json({ error: err.message || 'That file could not be uploaded' });
});

// ===== HEALTH =====

router.get('/api/health', (_req: Request, res: Response) => {
  return res.json({ status: 'ok', message: 'LocalLink API is running' });
});

// Unsubscribe from reminder emails via token link
router.get('/api/unsubscribe', (req: Request, res: Response) => {
  try {
    const { token } = req.query as { token?: string };
    if (!token) return res.status(400).send('<p>Invalid unsubscribe link.</p>');
    const user = db.prepare('SELECT id FROM users WHERE unsubToken = ?').get(token) as any;
    if (!user) return res.status(404).send('<p>Unsubscribe link not found.</p>');
    db.prepare('UPDATE users SET emailReminders = 0 WHERE id = ?').run(user.id);
    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    return res.send(`<!DOCTYPE html><html><head><title>Unsubscribed - LocalLink</title></head><body style="font-family:sans-serif;text-align:center;padding:60px;max-width:480px;margin:0 auto"><h1 style="color:#6366f1">LocalLink</h1><h2>Unsubscribed successfully</h2><p>You won't receive event reminder emails anymore.</p><p style="color:#888;font-size:13px;margin-top:16px">Note: Important account notifications (like post approvals) will still be sent.</p><a href="${appUrl}" style="display:inline-block;margin-top:24px;background:#6366f1;color:white;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:600">Back to LocalLink</a></body></html>`);
  } catch (err: any) {
    return res.status(500).send('<p>Something went wrong.</p>');
  }
});

router.post('/api/auth/mark-welcome-seen', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    db.prepare('UPDATE users SET hasSeenWelcome = 1 WHERE id = ?').run(req.userId!);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/featured-posts', (_req: Request, res: Response) => {
  try {
    let posts = db.prepare(
      "SELECT * FROM opportunities WHERE status = 'approved' AND isFeatured = 1 ORDER BY createdAt DESC"
    ).all() as any[];
    if (posts.length === 0) {
      posts = db.prepare(
        "SELECT * FROM opportunities WHERE status = 'approved' ORDER BY popularity DESC LIMIT 6"
      ).all() as any[];
    }
    const getSignups = db.prepare('SELECT userId FROM signups WHERE opportunityId = ?');
    const result = posts.map(opp =>
      withTags(opp, (getSignups.all(opp.id) as any[]).map((s: any) => s.userId))
    );
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/opportunities/:id/feature', requireAdmin, (req: Request, res: Response) => {
  try {
    const opp = db.prepare('SELECT isFeatured FROM opportunities WHERE id = ?').get(req.params.id) as any;
    if (!opp) return res.status(404).json({ error: 'Not found' });
    const newVal = opp.isFeatured ? 0 : 1;
    db.prepare('UPDATE opportunities SET isFeatured = ? WHERE id = ?').run(newVal, req.params.id);
    return res.json({ isFeatured: !!newVal });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== 24-hour event reminder cron =====
async function runReminderCron() {
  try {
    const now = new Date();
    // opportunities.date is a naive local string, so the window has to be
    // expressed the same way. Comparing it against toISOString() compared
    // wall-clock time to UTC and sent every reminder the server's offset
    // early — four hours, on a UTC host.
    const in23h = toAppLocalString(new Date(now.getTime() + 23 * 60 * 60 * 1000));
    const in25h = toAppLocalString(new Date(now.getTime() + 25 * 60 * 60 * 1000));
    // lastReminderAt is a real instant we write ourselves, so it stays UTC.
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();

    // One-time events starting in 23-25 hours
    const rows = db.prepare(`
      SELECT o.id as oppId, o.title, o.date, o.hostName,
             u.id as userId, u.email, u.username, u.emailReminders, u.unsubToken,
             s.lastReminderAt
      FROM opportunities o
      JOIN signups s ON s.opportunityId = o.id
      JOIN users u ON u.id = s.userId
      WHERE o.status = 'approved'
        AND o.isRecurring = 0
        AND o.date >= ? AND o.date <= ?
        AND u.emailReminders = 1
        AND (s.lastReminderAt IS NULL OR s.lastReminderAt < ?)
    `).all(in23h, in25h, twelveHoursAgo) as any[];

    for (const row of rows) {
      try {
        await sendEventReminderEmail(row.email, row.username, row.title, row.date, row.hostName, row.unsubToken || '');
        db.prepare('UPDATE signups SET lastReminderAt = ? WHERE opportunityId = ? AND userId = ?')
          .run(now.toISOString(), row.oppId, row.userId);
        console.log(`📧 24h reminder sent to ${row.email} for "${row.title}"`);
      } catch { /* ignore per-user failures */ }
    }

    // Recurring events — check if close time is in 23-25 hours
    const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const recurringRows = db.prepare(`
      SELECT o.id as oppId, o.title, o.hostName, o.recurringDay, o.recurringTime,
             u.id as userId, u.email, u.username, u.emailReminders, u.unsubToken,
             s.lastReminderAt
      FROM opportunities o
      JOIN signups s ON s.opportunityId = o.id
      JOIN users u ON u.id = s.userId
      WHERE o.status = 'approved'
        AND o.isRecurring = 1
        AND u.emailReminders = 1
        AND (s.lastReminderAt IS NULL OR s.lastReminderAt < ?)
    `).all(sixDaysAgo) as any[];

    for (const row of recurringRows) {
      try {
        if (row.recurringDay === null || row.recurringDay === undefined || !row.recurringTime) continue;
        const [h, m] = (row.recurringTime as string).split(':').map(Number);
        const dayOfWeek = row.recurringDay as number;
        const daysSinceMonday = (now.getDay() + 6) % 7;
        const mondayThisWeek = new Date(now);
        mondayThisWeek.setDate(now.getDate() - daysSinceMonday);
        mondayThisWeek.setHours(0, 0, 0, 0);
        const daysFromMonday = (dayOfWeek + 6) % 7;
        const closeTime = new Date(mondayThisWeek);
        closeTime.setDate(mondayThisWeek.getDate() + daysFromMonday);
        closeTime.setHours(h, m, 0, 0);
        const diffMs = closeTime.getTime() - now.getTime();
        if (diffMs >= 23 * 60 * 60 * 1000 && diffMs <= 25 * 60 * 60 * 1000) {
          await sendEventReminderEmail(row.email, row.username, row.title, closeTime.toISOString(), row.hostName, row.unsubToken || '');
          db.prepare('UPDATE signups SET lastReminderAt = ? WHERE opportunityId = ? AND userId = ?')
            .run(now.toISOString(), row.oppId, row.userId);
        }
      } catch { /* ignore per-item failures */ }
    }
  } catch (err) {
    console.error('[Reminder cron] error:', err);
  }
}

// Run immediately, then every hour
runReminderCron();
setInterval(runReminderCron, 60 * 60 * 1000);

// ===== JOIN LINKS (public) =====

// Public: look up a join link by slug
router.get('/api/join/:slug', (req: Request, res: Response) => {
  try {
    const link = db.prepare('SELECT slug, orgName, category, claimedAt FROM onboarding_links WHERE slug = ?').get(req.params.slug) as any;
    if (!link) return res.status(404).json({ error: 'Join link not found' });
    return res.json(link);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== JOIN LINKS (admin) =====

// List all join links
router.get('/api/admin/join-links', requireAdmin, (_req: Request, res: Response) => {
  try {
    const links = db.prepare('SELECT * FROM onboarding_links ORDER BY createdAt DESC').all();
    return res.json(links);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Create a join link
router.post('/api/admin/join-links', requireAdmin, (req: Request, res: Response) => {
  try {
    const { orgName, category } = req.body;
    if (!orgName?.trim()) return res.status(400).json({ error: 'Org name is required' });
    const slug = orgName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existing = db.prepare('SELECT slug FROM onboarding_links WHERE slug = ?').get(slug);
    if (existing) return res.status(409).json({ error: `A link with slug "${slug}" already exists` });
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO onboarding_links (slug, orgName, category, createdAt) VALUES (?, ?, ?, ?)').run(slug, orgName.trim(), category || null, createdAt);
    return res.status(201).json({ slug, orgName: orgName.trim(), category: category || null, createdAt, claimedAt: null, claimedBy: null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete a join link
router.delete('/api/admin/join-links/:slug', requireAdmin, (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM onboarding_links WHERE slug = ?').run(req.params.slug);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== VERIFIED BADGE (admin) =====

// Toggle verified badge for any user
router.put('/api/admin/users/:id/verify', requireAdmin, (req: Request, res: Response) => {
  try {
    const user = db.prepare('SELECT id, verified FROM users WHERE id = ?').get(req.params.id) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });
    const newVerified = user.verified ? 0 : 1;
    db.prepare('UPDATE users SET verified = ? WHERE id = ?').run(newVerified, req.params.id);
    return res.json({ verified: newVerified === 1 });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── signing in with Google ───
//
// Worth it here for one reason above convenience: Google tells us the address
// is real, so nobody has to go and find a verification email. Ours currently
// fails DMARC and may never arrive at all, which makes "check your inbox" the
// step most likely to lose a volunteer standing at an event.

/** So the client knows whether to render the button at all. */
router.get('/api/auth/google/enabled', (_req: Request, res: Response) =>
  res.json({ enabled: googleEnabled(), clientId: googleClientId() || null }));

/**
 * One route for all three cases: returning, linking, and brand new.
 *
 * A new person cannot be created from the Google token alone -- we still need
 * their account type, and their birth year for the 13+ floor and the 18+ gate
 * on adults-only events. So they come back a second time with the same token
 * plus those two answers, and it is re-verified. Nothing half-made is written
 * in between: an account either exists properly or does not exist.
 */
router.post('/api/auth/google', async (req: Request, res: Response) => {
  try {
    if (!googleEnabled()) {
      return res.status(503).json({ error: 'Signing in with Google is not set up yet.' });
    }
    const identity = await verifyGoogleToken(String(req.body?.credential ?? ''));
    if (!identity) {
      return res.status(401).json({ error: 'That Google sign-in could not be verified.' });
    }

    const emailNorm = normaliseEmail(identity.email);

    // 1. Seen this Google account before.
    let user = db.prepare('SELECT * FROM users WHERE googleSub = ?').get(identity.sub) as any;

    // 2. Or an existing password account on the same inbox -- link it.
    //    Only ever on a verified address. Linking on an unverified one would
    //    let somebody claim a stranger's volunteer record, and their hours,
    //    just by adding that address to a Google account and never proving it.
    if (!user && identity.emailVerified) {
      const existing = db.prepare(
        'SELECT * FROM users WHERE emailNorm = ? OR lower(email) = ?'
      ).get(emailNorm, identity.email) as any;
      if (existing) {
        // A row nobody ever verified is a row nobody has proved they own, and
        // because we match on the folded address (Gmail dots, a plus-tag) it
        // need not have been created by this person at all: anyone could have
        // registered v.i.c.t.i.m@gmail.com and waited. Linking marks it
        // verified, so the password it carries cannot survive that, or whoever
        // chose it would hold this account. Google, or a reset, from here.
        if (existing.emailVerified) {
          db.prepare('UPDATE users SET googleSub = ?, emailVerified = 1 WHERE id = ?')
            .run(identity.sub, existing.id);
        } else {
          const dead = await bcrypt.hash(randomBytes(32).toString('hex'), SALT_ROUNDS);
          db.prepare('UPDATE users SET googleSub = ?, emailVerified = 1, password = ? WHERE id = ?')
            .run(identity.sub, dead, existing.id);
        }
        user = { ...existing, googleSub: identity.sub, emailVerified: 1 };
      }
    }

    // 3. Nobody yet. Ask the two things Google cannot tell us.
    if (!user) {
      if (!identity.emailVerified) {
        return res.status(403).json({
          error: 'Google has not verified that email address, so we cannot use it to sign you in.',
        });
      }
      const accountType = req.body?.accountType;
      const birthYear = req.body?.birthYear;
      if (accountType !== 'volunteer' && accountType !== 'organization') {
        return res.json({ needsProfile: true, email: identity.email, name: identity.name });
      }

      let resolvedBirthYear: number | null = null;
      if (accountType === 'volunteer') {
        const year = Number(birthYear);
        const thisYear = new Date().getFullYear();
        if (!Number.isInteger(year) || year < 1900 || year > thisYear) {
          return res.json({ needsProfile: true, email: identity.email, name: identity.name });
        }
        if (thisYear - year < 13) {
          return res.status(403).json({ error: 'You need to be at least 13 to use LocalLink.' });
        }
        resolvedBirthYear = year;
      }

      const taken = (u: string) =>
        !!db.prepare('SELECT 1 FROM users WHERE username = ?').get(u);
      const username = usernameFrom(identity.name, identity.email, taken);
      const id = randomUUID();
      // No password. Signing in happens through Google, and a random one nobody
      // holds is better than a placeholder somebody might guess.
      const placeholder = await bcrypt.hash(randomBytes(32).toString('hex'), SALT_ROUNDS);

      db.prepare(
        `INSERT INTO users (id, username, email, emailNorm, googleSub, password, isAdmin, emailVerified,
           accountType, hasSeenWelcome, unsubToken, verified, notifyOnInterest, birthYear, fullName, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, 0, 1, ?, ?, ?)`
      ).run(id, username, identity.email, emailNorm, identity.sub, placeholder,
        identity.email === ADMIN_EMAIL ? 1 : 0, accountType, randomUUID(),
        resolvedBirthYear,
        // Google gave us their actual name, which is what a certificate needs
        // and what an organization sees on its roster. Asking again would be
        // asking for something we already have.
        identity.name, new Date().toISOString());

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    }

    if (user.banned) {
      return res.status(403).json({ error: 'This account has been suspended.' });
    }

    const token = jwt.sign(
      { userId: user.id, isAdmin: !!user.isAdmin },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    const { password: _pw, ...safeUser } = user;
    return res.json({
      ...safeUser,
      isAdmin: !!user.isAdmin,
      emailVerified: true,
      notifyOnInterest: !!user.notifyOnInterest,
      notifyOnReopen: user.notifyOnReopen !== 0,
      emailReminders: !!user.emailReminders,
      hasSeenWelcome: !!user.hasSeenWelcome,
      verified: !!user.verified,
      ...onboardingFields(user),
      token,
    });
  } catch (err: any) {
    console.error('[auth/google]', err);
    return res.status(500).json({ error: 'Could not sign you in with Google' });
  }
});

// ═══════════════════════════════ HOUR TRACKING ═══════════════════════════════
//
// A volunteer records what they did, the organization confirms it from an email
// with no account, and confirmed hours become a certificate a school can check.

/** Squashed organization name, so "Arm in Arm" and "arm  in  ARM" are one
 *  organization rather than two. */
const orgKeyOf = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const isOrgConfirmed = (key: string) =>
  !!db.prepare('SELECT 1 FROM confirmed_orgs WHERE orgKey = ?').get(key);

/**
 * Whether an entry counts as the strong kind a school asks for.
 *
 * Almost always this is automatic: the organization on LocalLink confirmed it,
 * or the address was at an organization's own domain. The admin list is the
 * exception that automation cannot cover -- a real Somerset County charity run
 * out of somebody's Gmail account, which is common enough here to matter. One
 * admin can vouch for that organization, and its entries then count like any
 * other. It is an upgrade path, not the gate it used to be.
 */
const strongEntry = (row: { approverKind?: string | null; orgKey?: string }): boolean =>
  isStrong(row.approverKind as any) || (!!row.orgKey && isOrgConfirmed(row.orgKey));

/** Events the volunteer signed up for that have already happened and have no
 *  hours logged against them yet. This is the list behind the one-tap "log the
 *  hours for this" button -- the whole reason the tracker belongs inside the
 *  site rather than beside it. */
/** The volunteer's own hours target. Null clears it. */
/**
 * The name a real person will read: on the organization's attendance list, in
 * the approval email, and on the certificate. Set once and then fixed.
 *
 * Fixed because it is the identity on a record a school trusts. If it could
 * still be changed, renaming to a classmate, issuing a certificate, and
 * renaming back would hand them a genuine-looking record in their own name.
 */
router.put('/api/me/full-name', requireAuth, (req: AuthRequest, res: Response) => {
  const name = String(req.body?.fullName ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ error: 'Enter your full name as your school knows it' });
  }
  const user = db.prepare('SELECT fullName FROM users WHERE id = ?').get(req.userId) as any;
  if (user?.fullName) {
    return res.status(409).json({ error: 'Your name is already set. Ask us if it needs correcting.' });
  }
  db.prepare('UPDATE users SET fullName = ? WHERE id = ?').run(name, req.userId);
  return res.json({ fullName: name });
});

router.put('/api/me/goal-hours', requireAuth, (req: AuthRequest, res: Response) => {
  const raw = req.body?.goalHours;
  const goal = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  if (goal !== null && (!Number.isFinite(goal) || goal <= 0 || goal > 10000)) {
    return res.status(400).json({ error: 'Enter a number of hours between 1 and 10000' });
  }
  db.prepare('UPDATE users SET goalHours = ? WHERE id = ?').run(goal, req.userId);
  return res.json({ goalHours: goal });
});

router.get('/api/hours/loggable', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT o.id, o.title, o.date, o.duration, o.hostName, o.location,
             u.email AS hostEmail, u.username AS hostContact
      FROM signups s
      JOIN opportunities o ON o.id = s.opportunityId
      LEFT JOIN users u ON u.id = o.hostId
      WHERE s.userId = ?
        AND o.date < ?
        AND NOT EXISTS (
          SELECT 1 FROM hour_logs h WHERE h.opportunityId = o.id AND h.volunteerId = ?
        )
      ORDER BY o.date DESC
      LIMIT 25
    `).all(req.userId, new Date().toISOString(), req.userId) as any[];
    return res.json(rows);
  } catch (err: any) {
    console.error('[hours/loggable]', err);
    return res.status(500).json({ error: 'Could not load your past events' });
  }
});

router.get('/api/hours', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT h.* FROM hour_logs h WHERE h.volunteerId = ?
      ORDER BY h.serviceDate DESC, h.submittedAt DESC
    `).all(req.userId) as any[];

    const counted = rows.filter(r => r.status === 'approved' || r.status === 'adjusted');
    const hoursOf = (r: any) => (r.approvedHours ?? r.hours) as number;
    const user = db.prepare('SELECT goalHours, fullName FROM users WHERE id = ?').get(req.userId) as any;

    return res.json({
      logs: rows.map(r => ({
        id: r.id, opportunityId: r.opportunityId, orgName: r.orgName,
        orgConfirmed: strongEntry(r), approverKind: r.approverKind,
        approverEmail: r.approverEmail, source: r.source,
        activity: r.activity, serviceDate: r.serviceDate,
        hours: r.hours, status: r.status, approvedHours: r.approvedHours,
        approverName: r.approverName, approverNote: r.approverNote,
        submittedAt: r.submittedAt, decidedAt: r.decidedAt, startedAt: r.startedAt,
      })),
      fullName: user?.fullName ?? null,
      totals: {
        confirmed: counted.reduce((s, r) => s + hoursOf(r), 0),
        fromConfirmedOrgs: counted.filter(strongEntry).reduce((s, r) => s + hoursOf(r), 0),
        waiting: rows.filter(r => r.status === 'pending').reduce((s, r) => s + r.hours, 0),
        running: rows.filter(r => r.status === 'running').length,
        goalHours: user?.goalHours ?? null,
      },
    });
  } catch (err: any) {
    console.error('[hours]', err);
    return res.status(500).json({ error: 'Could not load your hours' });
  }
});

router.post('/api/hours', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT id, username, fullName, email, accountType FROM users WHERE id = ?')
      .get(req.userId) as any;
    if (user.accountType !== 'volunteer') {
      return res.status(403).json({ error: 'Only volunteer accounts can log hours' });
    }

    const { opportunityId, orgName, approverEmail, approverName, activity, serviceDate, hours } = req.body ?? {};

    // Logging against a real event fills in the organization and date from the
    // post itself, so those cannot disagree with what was actually posted.
    let resolvedOrg = String(orgName ?? '').trim();
    let resolvedDate = String(serviceDate ?? '');
    let hostEmail: string | null = null;
    let advertisedHours: number | null = null;
    if (opportunityId) {
      const opp = db.prepare(`
        SELECT o.id, o.hostName, o.date, o.duration, u.email AS hostEmail
        FROM opportunities o LEFT JOIN users u ON u.id = o.hostId
        WHERE o.id = ?
      `).get(opportunityId) as any;
      if (!opp) return res.status(404).json({ error: 'That opportunity no longer exists' });
      const signedUp = db.prepare('SELECT 1 FROM signups WHERE opportunityId = ? AND userId = ?')
        .get(opportunityId, user.id);
      if (!signedUp) {
        return res.status(403).json({ error: 'You can only log hours for events you signed up for' });
      }
      const already = db.prepare('SELECT 1 FROM hour_logs WHERE opportunityId = ? AND volunteerId = ?')
        .get(opportunityId, user.id);
      if (already) return res.status(409).json({ error: 'You have already logged hours for that event' });
      resolvedOrg = opp.hostName;
      resolvedDate = String(opp.date).slice(0, 10);
      hostEmail = opp.hostEmail || null;
      advertisedHours = Number(opp.duration) || null;
    }

    if (!resolvedOrg) return res.status(400).json({ error: 'Who did you volunteer with?' });
    if (!String(activity ?? '').trim()) return res.status(400).json({ error: 'Say briefly what you did' });
    if (String(activity).length > 300) return res.status(400).json({ error: 'Keep that under 300 characters' });

    const email = String(approverEmail ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email for the person who can confirm this' });
    }
    // Inbox comparison, not string comparison. "you+dana@gmail.com" and
    // "y.o.u@gmail.com" both reach the same place as "you@gmail.com", so a
    // plain compare let a student name themselves as their own approver.
    if (sameInbox(email, user.email)) {
      return res.status(400).json({ error: 'Someone else has to confirm your hours, not you' });
    }
    const emailNorm = normaliseEmail(email);
    // The same trick one step out: a second LocalLink account of your own.
    // The same trick one step out: a second VOLUNTEER account of your own, or a
    // classmate's. Organization accounts are deliberately excluded -- naming the
    // organization that posted the event is the strongest case there is, not
    // something to block.
    const otherVolunteer = db.prepare(
      "SELECT 1 FROM users WHERE id != ? AND accountType = 'volunteer' AND lower(email) = ?"
    ).get(user.id, email) as any;
    if (otherVolunteer) {
      return res.status(400).json({
        error: 'That is a volunteer account. Hours have to be confirmed by someone at the organization.',
      });
    }

    const n = Number(hours);
    if (!Number.isFinite(n) || n <= 0 || n > 24) {
      return res.status(400).json({ error: 'Hours must be between 0 and 24 for a single day' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedDate)) {
      return res.status(400).json({ error: 'Pick the date you volunteered' });
    }
    if (resolvedDate > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: 'That date is in the future' });
    }

    // An event that advertised three hours cannot yield eight. A little slack,
    // because events do run over and the volunteer is not the one who decides
    // when they are allowed to leave.
    if (advertisedHours && n > advertisedHours + 2) {
      return res.status(400).json({
        error: `That event was posted as ${advertisedHours} hours. Log up to ${advertisedHours + 2}, and say in the description if it ran long.`,
      });
    }

    // A day has a ceiling however many entries it is split across. Without this
    // the 24-hour per-entry bound means nothing: ten entries on one date is 240.
    const DAY_CEILING = 16;
    const already = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN status = 'rejected' THEN 0
                               ELSE COALESCE(approvedHours, hours) END), 0) AS total
      FROM hour_logs WHERE volunteerId = ? AND serviceDate = ?
    `).get(user.id, resolvedDate) as any;
    if (Number(already.total) + n > DAY_CEILING) {
      return res.status(400).json({
        error: `That would put you over ${DAY_CEILING} hours on one day. If that is right, log it as separate days.`,
      });
    }

    // A ceiling on how fast entries can be filed at all, so a script cannot
    // file hundreds while nobody is looking.
    const recent = db.prepare(
      "SELECT COUNT(*) AS n FROM hour_logs WHERE volunteerId = ? AND submittedAt > ?"
    ).get(user.id, new Date(Date.now() - 864e5).toISOString()) as any;
    if (Number(recent.n) >= 20) {
      return res.status(429).json({ error: 'That is a lot of entries in one day. Try again tomorrow.' });
    }

    const id = randomUUID();
    const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const now = new Date().toISOString();
    // The supervisor has to recognise who this is. "soccerkid09 says they
    // volunteered 4 hours with you" is a handle they cannot match to anyone who
    // actually turned up.
    const volunteerName = user.fullName || user.username;

    // Decided here, from the post and the address -- never from anything the
    // student typed. This is the trust tier.
    const approverKind = approverKindFor(email, hostEmail);

    db.prepare(`
      INSERT INTO hour_logs
        (id, volunteerId, opportunityId, orgName, orgKey, activity, serviceDate, hours,
         status, approverEmail, approverEmailNorm, approverKind, source,
         approverName, approvalToken, tokenExpiresAt, submittedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 'self', ?, ?, ?, ?)
    `).run(id, user.id, opportunityId || null, resolvedOrg, orgKeyOf(resolvedOrg),
      String(activity).trim(), resolvedDate, n, email, emailNorm, approverKind,
      String(approverName ?? '').trim() || null, token,
      new Date(Date.now() + 30 * 864e5).toISOString(), now);

    sendHourApprovalRequest({
      to: email, approverName: String(approverName ?? '').trim() || null,
      volunteerName, orgName: resolvedOrg, activity: String(activity).trim(),
      serviceDate: resolvedDate, hours: n, token,
    }).catch(e => console.error('[email] hour approval request failed:', e.message));

    return res.json({ id, status: 'pending' });
  } catch (err: any) {
    console.error('[hours:create]', err);
    return res.status(500).json({ error: 'Could not save those hours' });
  }
});

/** Withdrawing deletes rather than edits. The approval email already sent
 *  describes the numbers in this record, so an edit would leave the two
 *  disagreeing about what is being approved. */
router.delete('/api/hours/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const row = db.prepare('SELECT volunteerId, status FROM hour_logs WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.volunteerId !== req.userId) return res.status(403).json({ error: 'Not yours to remove' });
  // A confirmed entry is locked -- that is what makes the record worth
  // something. A REJECTED one is not: the commonest cause is a mistyped
  // address reaching someone who has never heard of the volunteer, and the
  // email invites exactly that person to press "they did not volunteer with
  // us". Leaving that permanent, with no appeal and no way to re-log, punishes
  // a typo far harder than it punishes a liar.
  if (row.status === 'approved' || row.status === 'adjusted') {
    return res.status(400).json({ error: 'Confirmed hours cannot be removed' });
  }
  db.prepare('DELETE FROM hour_logs WHERE id = ?').run(req.params.id);
  return res.json({ success: true });
});

// ─── the approver's side: no account, one link, one use ───

router.get('/api/approve-hours/:token', (req: Request, res: Response) => {
  const row = db.prepare(`
    SELECT h.*, u.username AS volunteerName
    FROM hour_logs h JOIN users u ON u.id = h.volunteerId
    WHERE h.approvalToken = ?
  `).get(req.params.token) as any;
  if (!row) return res.status(404).json({ error: 'This link is not valid.' });
  if (new Date(row.tokenExpiresAt) < new Date()) {
    return res.status(410).json({ error: 'This link has expired. Ask the volunteer to submit again.' });
  }
  return res.json({
    volunteerName: row.volunteerName, orgName: row.orgName, activity: row.activity,
    serviceDate: row.serviceDate, hours: row.hours, approverName: row.approverName,
  });
});

router.post('/api/approve-hours/:token', async (req: Request, res: Response) => {
  try {
    const { decision, hours, note, approverName } = req.body ?? {};
    if (!['approve', 'adjust', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'Choose approve, adjust or reject' });
    }
    const row = db.prepare(`
      SELECT h.*, u.email AS volunteerEmail FROM hour_logs h
      JOIN users u ON u.id = h.volunteerId WHERE h.approvalToken = ?
    `).get(req.params.token) as any;
    if (!row) return res.status(404).json({ error: 'This link is not valid.' });
    if (new Date(row.tokenExpiresAt) < new Date()) {
      return res.status(410).json({ error: 'This link has expired.' });
    }

    let status = decision === 'reject' ? 'rejected' : decision === 'adjust' ? 'adjusted' : 'approved';
    let finalHours = row.hours;
    if (decision === 'adjust') {
      const n = Number(hours);
      if (!Number.isFinite(n) || n < 0 || n > 24) {
        return res.status(400).json({ error: 'Enter a number of hours between 0 and 24' });
      }
      finalHours = n;
      if (n === row.hours) status = 'approved'; // same number is an approval, not a change
    }

    // Clearing the token makes the link single use, so a forwarded email cannot
    // have its decision overwritten by whoever receives it next.
    db.prepare(`
      UPDATE hour_logs SET status = ?, approvedHours = ?, approverNote = ?,
        approverName = COALESCE(?, approverName), decidedAt = ?, approvalToken = NULL
      WHERE id = ?
    `).run(status, decision === 'reject' ? 0 : finalHours,
      String(note ?? '').trim().slice(0, 300) || null,
      String(approverName ?? '').trim() || null, new Date().toISOString(), row.id);

    sendHourDecisionNotice({
      to: row.volunteerEmail, orgName: row.orgName, status,
      hours: finalHours, note: String(note ?? '').trim() || null,
    }).catch(e => console.error('[email] hour decision notice failed:', e.message));

    db.prepare(
      'INSERT INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(randomUUID(), row.volunteerId, 'hours_decided',
      status === 'rejected'
        ? `${row.orgName} did not confirm your ${row.hours} hours.`
        : `${row.orgName} confirmed ${finalHours} hours. They now count toward your certificate.`,
      new Date().toISOString());

    return res.json({ success: true, status, hours: decision === 'reject' ? 0 : finalHours });
  } catch (err: any) {
    console.error('[approve-hours]', err);
    return res.status(500).json({ error: 'Could not record that decision' });
  }
});

// ─── certificates ───

/** A code someone reads off paper and types. No I, O, 0 or 1 -- those are the
 *  characters people get wrong. */
function makeCertCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = () => Array.from(randomBytes(4)).map(b => alphabet[b % alphabet.length]).join('');
  return `${pick()}-${pick()}`;
}

router.post('/api/certificates', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT id, username, fullName, accountType FROM users WHERE id = ?')
      .get(req.userId) as any;
    if (user.accountType !== 'volunteer') return res.status(403).json({ error: 'Volunteer accounts only' });

    // A record reading "jsmith2027" is worth nothing to a school, and username
    // is the only name this table has ever held. Asked for once, here, at the
    // moment it matters -- not bolted onto signup where nobody yet cares.
    const givenName = String(req.body?.fullName ?? '').trim();
    const holderName = user.fullName || givenName;
    if (!holderName) {
      return res.status(400).json({ error: 'NEED_NAME', message: 'What name should the certificate show?' });
    }
    if (holderName.length < 2 || holderName.length > 80) {
      return res.status(400).json({ error: 'Enter your full name as your school knows it' });
    }
    // Stored once and then fixed. If it could still be edited, renaming to a
    // classmate, issuing, and renaming back would hand them a genuine-looking
    // record in their own name.
    if (!user.fullName) {
      db.prepare('UPDATE users SET fullName = ? WHERE id = ?').run(holderName, user.id);
    }

    const rows = db.prepare(`
      SELECT h.* FROM hour_logs h
      WHERE h.volunteerId = ? AND h.status IN ('approved', 'adjusted')
      ORDER BY h.serviceDate ASC
    `).all(user.id) as any[];
    if (rows.length === 0) {
      return res.status(400).json({ error: 'You need at least one confirmed entry before making a certificate' });
    }

    const hoursOf = (r: any) => (r.approvedHours ?? r.hours) as number;
    const total = rows.reduce((s, r) => s + hoursOf(r), 0);
    // "Strong" is the organization on LocalLink, or an address at the
    // organization's own domain -- which is exactly what schools already ask
    // for. It is decided from the post and the address, never from a name a
    // student typed.
    const confirmedTotal = rows.filter(strongEntry).reduce((s, r) => s + hoursOf(r), 0);
    const id = randomUUID();
    let code = makeCertCode();
    while (db.prepare('SELECT 1 FROM certificates WHERE code = ?').get(code)) code = makeCertCode();

    db.transaction(() => {
      db.prepare(`INSERT INTO certificates
        (id, volunteerId, code, holderName, totalHours, confirmedOrgHours, issuedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.id, code, holderName, total, confirmedTotal, new Date().toISOString());
      const entry = db.prepare(`INSERT INTO certificate_entries
        (certificateId, hourLogId, orgName, orgConfirmed, activity, serviceDate, hours,
         approverName, approverEmail, approverKind, decidedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of rows) {
        entry.run(id, r.id, r.orgName, strongEntry(r) ? 1 : 0, r.activity,
          r.serviceDate, hoursOf(r), r.approverName, r.approverEmail, r.approverKind, r.decidedAt);
      }
    })();

    return res.json({ id, code });
  } catch (err: any) {
    console.error('[certificates]', err);
    return res.status(500).json({ error: 'Could not make that certificate' });
  }
});

router.get('/api/certificates', requireAuth, (req: AuthRequest, res: Response) => {
  return res.json(db.prepare(
    'SELECT id, code, totalHours, confirmedOrgHours, issuedAt, revokedAt FROM certificates WHERE volunteerId = ? ORDER BY issuedAt DESC'
  ).all(req.userId));
});

/** Public on purpose. A teacher holding a printed certificate has no account
 *  here, and asking them to make one is the fastest way to have it disbelieved. */
router.get('/api/verify-hours/:code', (req: Request, res: Response) => {
  const cert = db.prepare('SELECT * FROM certificates WHERE code = ?')
    .get(String(req.params.code).trim().toUpperCase()) as any;
  if (!cert) return res.status(404).json({ error: 'No certificate with that code.' });
  const entries = db.prepare(
    'SELECT orgName, orgConfirmed, activity, serviceDate, hours, approverName, approverEmail, approverKind FROM certificate_entries WHERE certificateId = ? ORDER BY serviceDate ASC'
  ).all(cert.id) as any[];
  return res.json({
    holderName: cert.holderName, totalHours: cert.totalHours,
    confirmedOrgHours: cert.confirmedOrgHours, issuedAt: cert.issuedAt,
    revoked: !!cert.revokedAt,
    entries: entries.map(e => ({ ...e, orgConfirmed: !!e.orgConfirmed })),
  });
});

// ─── admin: which organizations are confirmed real ───

router.get('/api/admin/hour-orgs', requireAdmin, (_req: Request, res: Response) => {
  // The old version of this screen showed a name and two numbers, which is not
  // enough to decide anything. What actually answers "is this real" is the
  // addresses doing the confirming -- so those are the screen now.
  const rows = db.prepare(`
    SELECT h.orgKey, MAX(h.orgName) AS orgName, COUNT(*) AS entries,
           SUM(CASE WHEN h.status IN ('approved','adjusted') THEN 1 ELSE 0 END) AS confirmedEntries,
           SUM(CASE WHEN h.source = 'roster' THEN 1 ELSE 0 END) AS rosterEntries,
           SUM(CASE WHEN h.approverKind = 'personal' THEN 1 ELSE 0 END) AS personalEntries,
           COUNT(DISTINCT h.volunteerId) AS volunteers,
           COUNT(DISTINCT h.approverEmailNorm) AS approvers,
           (SELECT 1 FROM confirmed_orgs c WHERE c.orgKey = h.orgKey) AS confirmed
    FROM hour_logs h GROUP BY h.orgKey ORDER BY confirmed ASC, COUNT(*) DESC
  `).all() as any[];

  const addrs = db.prepare(`
    SELECT orgKey, approverEmail, approverKind, COUNT(*) AS n
    FROM hour_logs WHERE approverEmail IS NOT NULL
    GROUP BY orgKey, approverEmailNorm ORDER BY n DESC
  `).all() as any[];
  const byOrg = new Map<string, any[]>();
  for (const a of addrs) {
    if (!byOrg.has(a.orgKey)) byOrg.set(a.orgKey, []);
    byOrg.get(a.orgKey)!.push({ email: a.approverEmail, kind: a.approverKind, n: a.n });
  }

  return res.json(rows.map(r => ({
    ...r,
    confirmed: !!r.confirmed,
    approverAddresses: (byOrg.get(r.orgKey) ?? []).slice(0, 6),
  })));
});

/**
 * Patterns worth a human look. Not accusations -- every one of these has an
 * innocent explanation, which is why it is a list to read rather than a rule
 * that blocks anybody.
 */
router.get('/api/admin/hour-flags', requireAdmin, (_req: Request, res: Response) => {
  // One personal address confirming for several different students. A parent
  // helping at a real charity looks exactly like this, so it is shown, not acted on.
  const busyApprovers = db.prepare(`
    SELECT approverEmail, COUNT(DISTINCT volunteerId) AS students, COUNT(*) AS entries,
           SUM(CASE WHEN status IN ('approved','adjusted') THEN COALESCE(approvedHours, hours) ELSE 0 END) AS hours
    FROM hour_logs
    WHERE approverKind = 'personal' AND approverEmail IS NOT NULL
    GROUP BY approverEmailNorm
    HAVING COUNT(DISTINCT volunteerId) >= 3
    ORDER BY hours DESC LIMIT 25
  `).all() as any[];

  // Volunteers whose record leans heavily on personal-address confirmations.
  const leanRecords = db.prepare(`
    SELECT u.id, COALESCE(u.fullName, u.username) AS name, u.email,
           SUM(CASE WHEN h.status IN ('approved','adjusted') THEN COALESCE(h.approvedHours, h.hours) ELSE 0 END) AS total,
           SUM(CASE WHEN h.status IN ('approved','adjusted') AND h.approverKind = 'personal'
                    THEN COALESCE(h.approvedHours, h.hours) ELSE 0 END) AS personal
    FROM hour_logs h JOIN users u ON u.id = h.volunteerId
    GROUP BY h.volunteerId
    HAVING total >= 10 AND personal > total * 0.6
    ORDER BY personal DESC LIMIT 25
  `).all() as any[];

  return res.json({ busyApprovers, leanRecords });
});

router.post('/api/admin/hour-orgs/:key/confirm', requireAdmin, (req: AuthRequest, res: Response) => {
  const key = String(req.params.key);
  const confirm = req.body?.confirmed !== false;
  const row = db.prepare('SELECT orgName FROM hour_logs WHERE orgKey = ? LIMIT 1').get(key) as any;
  if (!row) return res.status(404).json({ error: 'No hours logged against that organization' });
  if (confirm) {
    db.prepare('INSERT OR REPLACE INTO confirmed_orgs (orgKey, orgName, confirmedBy, confirmedAt) VALUES (?, ?, ?, ?)')
      .run(key, row.orgName, req.userId, new Date().toISOString());
  } else {
    db.prepare('DELETE FROM confirmed_orgs WHERE orgKey = ?').run(key);
  }
  return res.json({ success: true, confirmed: confirm });
});

// ─── the roster lane: one email per event, not one per volunteer ───
//
// Everything above starts from a claim the volunteer types. This starts from
// what we already know: who posted the event, when it was, how long it was
// advertised for, and who signed up. The volunteer types nothing at all, and
// there is correspondingly nothing for them to forge.

/** Signed up, but no hours at all -- never scanned, or came without a phone.
 *  The organizer can add them. */
function rosterFor(opportunityId: string) {
  return db.prepare(`
    SELECT u.id, COALESCE(u.fullName, u.username) AS name
    FROM signups s JOIN users u ON u.id = s.userId
    WHERE s.opportunityId = ?
      AND u.accountType = 'volunteer'
      AND (u.banned IS NULL OR u.banned = 0)
      AND NOT EXISTS (
        SELECT 1 FROM hour_logs h
        WHERE h.opportunityId = s.opportunityId AND h.volunteerId = u.id
      )
    ORDER BY name COLLATE NOCASE
  `).all(opportunityId) as { id: string; name: string }[];
}

/**
 * Scanned in and never scanned out. We gave them the posted length because a
 * dead battery and a walk-out look identical from here -- but somebody who
 * photographed the printed sheet and scanned it from home looks identical too,
 * and this list is the only thing that catches them. It is why the email exists.
 */
function unclosedFor(opportunityId: string) {
  return db.prepare(`
    SELECT h.id AS logId, h.volunteerId AS id, COALESCE(u.fullName, u.username) AS name,
           h.hours, h.startedAt
    FROM hour_logs h JOIN users u ON u.id = h.volunteerId
    WHERE h.opportunityId = ? AND h.closedBy = 'auto'
    ORDER BY name COLLATE NOCASE
  `).all(opportunityId) as any[];
}

router.get('/api/attendance/:token', (req: Request, res: Response) => {
  const reqRow = db.prepare(`
    SELECT a.*, o.title, o.date, o.duration, o.hostName
    FROM attendance_requests a JOIN opportunities o ON o.id = a.opportunityId
    WHERE a.token = ?
  `).get(String(req.params.token)) as any;
  if (!reqRow) return res.status(404).json({ error: 'This link is not valid.' });
  if (new Date(reqRow.expiresAt) < new Date()) {
    return res.status(410).json({ error: 'This link has expired.' });
  }
  return res.json({
    eventTitle: reqRow.title,
    serviceDate: String(reqRow.date).slice(0, 10),
    hours: Number(reqRow.duration) || 1,
    hostName: reqRow.hostName,
    alreadyAnswered: !!reqRow.respondedAt,
    roster: rosterFor(reqRow.opportunityId),
    unclosed: unclosedFor(reqRow.opportunityId),
  });
});

router.post('/api/attendance/:token', (req: Request, res: Response) => {
  try {
    const reqRow = db.prepare(`
      SELECT a.*, o.title, o.date, o.duration, o.hostName, u.email AS hostEmail,
             u.username AS hostUsername
      FROM attendance_requests a
      JOIN opportunities o ON o.id = a.opportunityId
      LEFT JOIN users u ON u.id = a.hostId
      WHERE a.token = ?
    `).get(String(req.params.token)) as any;
    if (!reqRow) return res.status(404).json({ error: 'This link is not valid.' });
    if (new Date(reqRow.expiresAt) < new Date()) {
      return res.status(410).json({ error: 'This link has expired.' });
    }
    if (reqRow.respondedAt) {
      return res.status(409).json({ error: 'This has already been answered.' });
    }

    const present: { userId: string; hours: number }[] = Array.isArray(req.body?.present)
      ? req.body.present : [];
    const allowed = new Map(rosterFor(reqRow.opportunityId).map(r => [r.id, r.name]));
    const advertised = Number(reqRow.duration) || 1;
    const serviceDate = String(reqRow.date).slice(0, 10);
    const now = new Date().toISOString();
    // The organization is the approver here, so these are confirmed on arrival.
    // No second email, no waiting: the person who would have answered it is the
    // person who just answered this.
    const approverEmail = String(reqRow.hostEmail || '').toLowerCase();

    let added = 0;
    let removed = 0;
    db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO hour_logs
          (id, volunteerId, opportunityId, orgName, orgKey, activity, serviceDate, hours,
           status, approvedHours, approverEmail, approverEmailNorm, approverKind, source,
           approverName, submittedAt, decidedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, 'locallink_org', 'roster', ?, ?, ?)
      `);
      const notify = db.prepare(
        'INSERT INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)'
      );
      for (const entry of present) {
        const name = allowed.get(String(entry?.userId));
        if (!name) continue; // not on the roster, or already has hours
        let h = Number(entry?.hours);
        if (!Number.isFinite(h) || h <= 0) h = advertised;
        // The host can adjust, but not invent. Anything beyond the advertised
        // length plus a margin is a mistake or a favour, and neither belongs on
        // a record a school reads.
        h = Math.min(h, advertised + 2);
        insert.run(randomUUID(), entry.userId, reqRow.opportunityId, reqRow.hostName,
          orgKeyOf(reqRow.hostName), reqRow.title, serviceDate, h, h,
          approverEmail || null, approverEmail ? normaliseEmail(approverEmail) : null,
          reqRow.hostUsername || reqRow.hostName, now, now);
        notify.run(randomUUID(), entry.userId, 'hours_decided',
          `${reqRow.hostName} confirmed ${h} hours for ${reqRow.title}. They now count toward your certificate.`,
          now);
        added++;
      }
      // Anyone the organizer says was not there. Their auto-closed entry is
      // removed outright rather than marked rejected: nothing was ever
      // confirmed about it, so there is nothing to keep a record of.
      const strike: string[] = Array.isArray(req.body?.remove) ? req.body.remove : [];
      if (strike.length) {
        const del = db.prepare("DELETE FROM hour_logs WHERE id = ? AND opportunityId = ? AND closedBy = 'auto'");
        const tell = db.prepare(
          'INSERT INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)'
        );
        const owners = db.prepare('SELECT id, volunteerId FROM hour_logs WHERE opportunityId = ? AND closedBy = \'auto\'')
          .all(reqRow.opportunityId) as any[];
        const ownerOf = new Map(owners.map(o => [o.id, o.volunteerId]));
        for (const logId of strike) {
          const who = ownerOf.get(String(logId));
          if (!who) continue;
          del.run(String(logId), reqRow.opportunityId);
          tell.run(randomUUID(), who, 'hours_decided',
            `${reqRow.hostName} removed your hours for ${reqRow.title}. They did not have you down as attending.`,
            now);
          removed++;
        }
      }
      db.prepare('UPDATE attendance_requests SET respondedAt = ? WHERE id = ?').run(now, reqRow.id);
    })();

    return res.json({ success: true, confirmed: added, removed });
  } catch (err: any) {
    console.error('[attendance]', err);
    return res.status(500).json({ error: 'Could not record that' });
  }
});

/**
 * Ask the host of every finished event who turned up. Called hourly.
 *
 * Deliberately narrow: an event has to have ended, have people signed up who
 * still have no hours, and have a host we can actually reach. One request per
 * event ever -- the UNIQUE on opportunityId means a restart cannot double-send.
 */
export async function sendPendingAttendanceRequests(): Promise<number> {
  const now = new Date();
  // Wait until the day is over before asking, so nobody is emailed mid-event,
  // and give up after a fortnight -- by then the coordinator has forgotten.
  const endedBefore = new Date(now.getTime() - 12 * 36e5).toISOString();
  const notBefore = new Date(now.getTime() - 14 * 864e5).toISOString();

  const due = db.prepare(`
    SELECT o.id, o.title, o.date, o.duration, o.hostName, o.hostId,
           u.email AS hostEmail, u.username AS hostUsername, u.emailReminders
    FROM opportunities o
    JOIN users u ON u.id = o.hostId
    WHERE o.date < ? AND o.date > ?
      AND u.email IS NOT NULL
      AND (u.banned IS NULL OR u.banned = 0)
      AND NOT EXISTS (SELECT 1 FROM attendance_requests a WHERE a.opportunityId = o.id)
  `).all(endedBefore, notBefore) as any[];

  let sent = 0;
  for (const opp of due) {
    const roster = rosterFor(opp.id);
    const unclosed = unclosedFor(opp.id);
    // Only when there is something to ask. If everyone scanned in and out
    // cleanly there is nothing to say, and an email that says nothing is how a
    // coordinator learns to ignore us.
    if (roster.length === 0 && unclosed.length === 0) continue;
    if (opp.emailReminders === 0) continue; // they unsubscribed; respect it

    const token = randomBytes(32).toString('hex');
    try {
      db.prepare(`
        INSERT INTO attendance_requests (id, opportunityId, hostId, token, expiresAt, sentAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), opp.id, opp.hostId, token,
        new Date(now.getTime() + 30 * 864e5).toISOString(), now.toISOString());
    } catch {
      continue; // another worker got there first
    }

    try {
      await sendAttendanceRequest({
        to: opp.hostEmail,
        hostName: opp.hostUsername || opp.hostName,
        eventTitle: opp.title,
        serviceDate: String(opp.date).slice(0, 10),
        hours: Number(opp.duration) || 1,
        names: roster.map(r => r.name),
        unclosedNames: unclosed.map(r => r.name),
        token,
      });
      sent++;
    } catch (e: any) {
      // The row is written first so two workers cannot both send. But if the
      // send then fails, leaving it would mean this event is never asked about
      // again -- UNIQUE(opportunityId) makes the next pass skip it forever, and
      // everyone who came gets nothing. Drop it and let the next hour retry.
      console.error('[attendance] email failed, will retry next pass:', e.message);
      db.prepare('DELETE FROM attendance_requests WHERE token = ?').run(token);
    }
  }
  return sent;
}

// ─── scanning in and out ───
//
// The QR on the printed sheet encodes  /scan/<printedCode>
// The QR on the organizer's phone encodes  /scan/<printedCode>?k=<liveCode>
//
// So scanning the sheet identifies the event and nothing else, while scanning
// the phone also proves the scanner was standing in front of it within the last
// half minute. That is the whole difference between being able to open a clock
// and being able to close one.

/** Mint an event's codes the first time its organizer asks for them. */
function codesFor(oppId: string): { printedCode: string; codeSecret: string } {
  const row = db.prepare('SELECT printedCode, codeSecret FROM opportunities WHERE id = ?')
    .get(oppId) as any;
  if (row?.printedCode && row?.codeSecret) return row;
  const printedCode = newPrintedCode();
  const codeSecret = newEventSecret();
  db.prepare('UPDATE opportunities SET printedCode = ?, codeSecret = ? WHERE id = ?')
    .run(printedCode, codeSecret, oppId);
  return { printedCode, codeSecret };
}

/** What the organizer needs on screen: the sheet to print, and the live code. */
router.get('/api/events/:id/codes', requireAuth, (req: AuthRequest, res: Response) => {
  const opp = db.prepare('SELECT id, title, date, duration, hostId FROM opportunities WHERE id = ?')
    .get(req.params.id) as any;
  if (!opp) return res.status(404).json({ error: 'That event does not exist' });
  if (opp.hostId !== req.userId && !req.isAdmin) {
    return res.status(403).json({ error: 'Only the organization that posted this event can show its codes' });
  }
  const { printedCode, codeSecret } = codesFor(opp.id);
  const running = db.prepare(
    "SELECT COUNT(*) AS n FROM hour_logs WHERE opportunityId = ? AND status = 'running'"
  ).get(opp.id) as any;
  return res.json({
    eventTitle: opp.title,
    serviceDate: String(opp.date).slice(0, 10),
    hours: Number(opp.duration) || 1,
    printedCode,
    liveCode: liveCodeFor(codeSecret),
    secondsLeft: secondsLeft(),
    running: Number(running.n),
  });
});

/** What a volunteer sees the moment they scan, before doing anything. */
router.get('/api/scan/:code', requireAuth, (req: AuthRequest, res: Response) => {
  const opp = db.prepare(
    'SELECT id, title, date, duration, hostName FROM opportunities WHERE printedCode = ?'
  ).get(String(req.params.code)) as any;
  if (!opp) return res.status(404).json({ error: 'That code does not belong to any event.' });

  const mine = db.prepare(
    'SELECT id, status, startedAt, endedAt, hours, approvedHours FROM hour_logs WHERE opportunityId = ? AND volunteerId = ?'
  ).get(opp.id, req.userId) as any;

  return res.json({
    eventTitle: opp.title,
    orgName: opp.hostName,
    postedHours: Number(opp.duration) || 1,
    serviceDate: String(opp.date).slice(0, 10),
    state: !mine ? 'none' : mine.status === 'running' ? 'running' : 'done',
    startedAt: mine?.startedAt ?? null,
    hours: mine ? (mine.approvedHours ?? mine.hours) : null,
  });
});

router.post('/api/scan/:code', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT id, username, fullName, accountType FROM users WHERE id = ?')
      .get(req.userId) as any;
    if (user.accountType !== 'volunteer') {
      return res.status(403).json({ error: 'Only volunteer accounts can scan in' });
    }
    const opp = db.prepare(`
      SELECT o.id, o.title, o.date, o.duration, o.hostName, o.hostId, o.codeSecret,
             u.email AS hostEmail, u.username AS hostUsername
      FROM opportunities o LEFT JOIN users u ON u.id = o.hostId
      WHERE o.printedCode = ?
    `).get(String(req.params.code)) as any;
    if (!opp) return res.status(404).json({ error: 'That code does not belong to any event.' });

    // Present at the organizer's phone within the last half minute?
    const liveOk = !!opp.codeSecret && verifyLiveCode(opp.codeSecret, String(req.body?.liveCode ?? ''));

    const mine = db.prepare(
      'SELECT id, status, startedAt FROM hour_logs WHERE opportunityId = ? AND volunteerId = ?'
    ).get(opp.id, req.userId) as any;
    const now = new Date();
    const posted = Number(opp.duration) || 1;

    // ── closing ──
    if (mine && mine.status === 'running') {
      if (!liveOk) {
        return res.status(403).json({
          error: 'To finish, scan the code on the organizer\'s phone. The printed sheet can only start your time.',
          code: 'NEEDS_LIVE',
        });
      }
      const startedMs = new Date(mine.startedAt).getTime();
      const raw = (now.getTime() - startedMs) / 36e5;
      // Round to the nearest quarter hour, never above the posted length plus a
      // little -- an event that advertised three hours cannot pay eight because
      // somebody left their clock running in the car park.
      const hours = Math.max(0.25, Math.min(Math.round(raw * 4) / 4, posted + 2));
      db.prepare(`
        UPDATE hour_logs
        SET status = 'approved', hours = ?, approvedHours = ?, endedAt = ?, decidedAt = ?,
            closedBy = 'scan'
        WHERE id = ?
      `).run(hours, hours, now.toISOString(), now.toISOString(), mine.id);
      db.prepare(
        'INSERT INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)'
      ).run(randomUUID(), user.id, 'hours_decided',
        `${opp.hostName} confirmed ${hours} hours for ${opp.title}. They now count toward your certificate.`,
        now.toISOString());
      return res.json({ state: 'done', hours });
    }

    if (mine) return res.status(409).json({ error: 'Your time for this event is already recorded.' });

    // ── opening ──
    // Either code opens a clock. The printed sheet exists precisely so that
    // arriving does not require finding the organizer first.
    const startedAt = now.toISOString();
    db.prepare(`
      INSERT INTO hour_logs
        (id, volunteerId, opportunityId, orgName, orgKey, activity, serviceDate, hours,
         status, approverEmail, approverEmailNorm, approverKind, source, approverName,
         startedAt, submittedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'running', ?, ?, 'locallink_org', 'scan', ?, ?, ?)
    `).run(randomUUID(), user.id, opp.id, opp.hostName, orgKeyOf(opp.hostName), opp.title,
      String(opp.date).slice(0, 10),
      String(opp.hostEmail || '').toLowerCase() || null,
      opp.hostEmail ? normaliseEmail(opp.hostEmail) : null,
      opp.hostUsername || opp.hostName, startedAt, startedAt);

    return res.json({ state: 'running', startedAt });
  } catch (err: any) {
    console.error('[scan]', err);
    return res.status(500).json({ error: 'Could not record that scan' });
  }
});

/**
 * Close clocks nobody scanned out of.
 *
 * A dead battery and a deliberate walk-out look identical from here, so both get
 * the posted length and both are flagged to the organizer rather than judged by
 * us. Runs on the hourly tick.
 */
export function closeAbandonedClocks(): number {
  const cutoff = new Date(Date.now() - 12 * 36e5).toISOString();
  const rows = db.prepare(`
    SELECT h.id, h.volunteerId, h.orgName, o.title, o.duration
    FROM hour_logs h JOIN opportunities o ON o.id = h.opportunityId
    WHERE h.status = 'running' AND h.startedAt < ?
  `).all(cutoff) as any[];

  const now = new Date().toISOString();
  for (const r of rows) {
    const hours = Number(r.duration) || 1;
    db.prepare(`
      UPDATE hour_logs SET status = 'approved', hours = ?, approvedHours = ?,
        endedAt = ?, decidedAt = ?, closedBy = 'auto' WHERE id = ?
    `).run(hours, hours, now, now, r.id);
    db.prepare(
      'INSERT INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(randomUUID(), r.volunteerId, 'hours_decided',
      `You did not scan out of ${r.title}, so we recorded the ${hours} hours the event was posted for. ${r.orgName} can correct this.`,
      now);
  }
  return rows.length;
}

export default router;
