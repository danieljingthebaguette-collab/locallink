import { Router, type Request, type Response, type NextFunction } from 'express';
import db from './db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { sendVerificationEmail, sendPasswordResetEmail, sendSignupNotificationEmail, sendPostApprovedEmail, sendPostDeniedEmail, sendEventCancelledEmail, sendEventReminderEmail } from './email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure uploads directory exists — use the same persistent disk as the DB in production
const dbPath = process.env.DB_PATH;
const uploadsDir = dbPath
  ? path.join(path.dirname(dbPath), 'uploads')
  : path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config — store on disk with unique filenames, images only, 5 MB max
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

const router = Router();

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
function withTags(opp: any, signups: string[] = [], committed: string[] = []) {
  return { ...opp, tags: safeJsonParse<string[]>(opp.tags, []), steps: safeJsonParse<string[]>(opp.steps, []), signups, committed, hostVerified: !!opp.hostVerified };
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

// Allowed enum values — validated server-side to prevent garbage data
const VALID_SPOTS_TYPES  = ['limited', 'unlimited', 'none'] as const;
const VALID_CATEGORIES   = ['volunteer', 'education', 'fitness', 'environment', 'community'] as const;
const VALID_PINNED_SIZES = ['small', 'medium', 'large'] as const;
// Mirrors TOWNS in client/src/lib/mockData.ts — keep the two lists in sync
const VALID_TOWNS = [
  'Montgomery/Skillman', 'Hillsborough', 'Princeton', 'Bridgewater',
  'Somerville', 'Franklin Township', 'Manville', 'Raritan',
  'Belle Mead/Rocky Hill', 'Flemington',
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
    req.userId = payload.userId;
    req.isAdmin = payload.isAdmin;
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

router.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { username, email, password, accountType, joinSlug } = req.body;
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
      'INSERT INTO users (id, username, email, password, isAdmin, emailVerified, accountType, hasSeenWelcome, unsubToken, verified, notifyOnInterest, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)'
    ).run(id, username, email, hashedPassword, isAdmin, emailVerified, resolvedAccountType, 0, unsubToken, verified, createdAt);

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
    const { password: _pwd, ...safeUser } = user;
    return res.json({ ...safeUser, isAdmin: !!user.isAdmin, emailVerified: true, notifyOnInterest: !!user.notifyOnInterest, notifyOnReopen: user.notifyOnReopen !== 0, profileImage: user.profileImage || null, emailReminders: !!user.emailReminders, hasSeenWelcome: !!user.hasSeenWelcome, verified: !!user.verified, token });
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
    const { password: _pwd, ...safeUser } = user;

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

    // Delete any existing tokens for this user, then create a fresh one
    db.prepare('DELETE FROM email_verifications WHERE userId = ?').run(user.id);
    const newToken = randomUUID() + '-' + randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO email_verifications (token, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)'
    ).run(newToken, user.id, expiresAt, new Date().toISOString());

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
      'SELECT id, username, email, isAdmin, emailVerified, accountType, notifyOnInterest, notifyOnReopen, profileImage, orgDescription, orgWebsite, orgEmail, orgPhone, emailReminders, hasSeenWelcome, verified, createdAt FROM users WHERE id = ?'
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
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Public host profile — returns only username + profileImage, no auth required
router.get('/api/users/:id/profile', (req: Request, res: Response) => {
  try {
    const user = db.prepare(
      'SELECT username, profileImage FROM users WHERE id = ?'
    ).get(req.params.id) as any;
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ username: user.username, profileImage: user.profileImage || null });
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
    const getSignups = db.prepare('SELECT userId, committedAt FROM signups WHERE opportunityId = ?');
    const postsWithData = posts.map(opp =>
      withTags(opp, (getSignups.all(opp.id) as any[]).map((s: any) => s.userId),
        (getSignups.all(opp.id) as any[]).filter((s: any) => s.committedAt).map((s: any) => s.userId))
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
    const getSignups = db.prepare('SELECT userId, committedAt FROM signups WHERE opportunityId = ?');
    const result = opportunities.map(opp =>
      withTags(opp, (getSignups.all(opp.id) as any[]).map(s => s.userId),
        (getSignups.all(opp.id) as any[]).filter((s: any) => s.committedAt).map((s: any) => s.userId))
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
    const signupRows = db.prepare('SELECT userId, committedAt FROM signups WHERE opportunityId = ?').all(opp.id) as any[];
    const signups = signupRows.map(s => s.userId);
    const committed = signupRows.filter(s => s.committedAt).map(s => s.userId);
    return res.json(withTags(opp, signups, committed));
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
    const getSignups = db.prepare('SELECT userId, committedAt FROM signups WHERE opportunityId = ?');
    const result = posts.map(opp =>
      withTags(opp, (getSignups.all(opp.id) as any[]).map((s: any) => s.userId),
        (getSignups.all(opp.id) as any[]).filter((s: any) => s.committedAt).map((s: any) => s.userId))
    );
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Creating an opportunity requires being logged in as an org account (or admin)
router.post('/api/opportunities', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const { title, description, category, location, town, date, duration, spots, spotsType, image, tags, isRecurring, recurringDay, recurringTime, steps, externalSignupUrl } = req.body;
    if (!title || !description || !category || !location || !date || !duration) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const locationError = getLocationError(location);
    if (locationError) return res.status(400).json({ error: locationError });
    // Town is required on NEW posts (existing rows stay null until backfilled)
    if (!town || !VALID_TOWNS.includes(town)) {
      return res.status(400).json({ error: 'Please select a town from the list' });
    }
    // Never required — validated only when the org actually provided one
    const trimmedSignupUrl = typeof externalSignupUrl === 'string' ? externalSignupUrl.trim() : '';
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
      `INSERT INTO opportunities (id, title, description, category, location, town, date, duration, spots, spotsRemaining, spotsType, image, hostId, hostName, popularity, tags, steps, createdAt, isRecurring, recurringDay, recurringTime, status, externalSignupUrl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, title, description, category, location, town, date, duration, resolvedSpots, resolvedSpots, resolvedSpotsType, image || null, hostId, hostUser?.username || 'Unknown', tagsJson, stepsJson, createdAt, isRecurring ? 1 : 0, recurringDay ?? null, recurringTime ?? null, status, trimmedSignupUrl || null);

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

    const existing = db.prepare('SELECT id FROM signups WHERE opportunityId = ? AND userId = ?').get(oppId, userId);
    if (existing) return res.status(409).json({ error: 'Already interested' });

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
    const signupRows = db.prepare('SELECT userId, committedAt FROM signups WHERE opportunityId = ?').all(oppId) as any[];
    const signups = signupRows.map(s => s.userId);
    const committed = signupRows.filter(s => s.committedAt).map(s => s.userId);
    return res.json(withTags(updated, signups, committed));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** The step beyond Interested. Interested is a low-pressure bookmark and
 * stays exactly as it works today; Committed is what puts someone on the
 * organization's tracker roster — nothing else reads committedAt. A
 * volunteer can commit without ever having tapped Interested first (the
 * button creates the signup), same as scanning in cold at the door does. */
router.post('/api/opportunities/:id/signup/commit', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.id;
    const userId = req.userId!;
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    const now = new Date().toISOString();
    const existing = db.prepare('SELECT * FROM signups WHERE opportunityId = ? AND userId = ?').get(oppId, userId) as any;
    if (existing) {
      if (!existing.committedAt) db.prepare('UPDATE signups SET committedAt = ? WHERE id = ?').run(now, existing.id);
    } else {
      db.prepare('INSERT INTO signups (opportunityId, userId, committedAt, createdAt) VALUES (?, ?, ?, ?)').run(oppId, userId, now, now);
      db.prepare('UPDATE opportunities SET popularity = popularity + 1 WHERE id = ?').run(oppId);
    }

    if (opp.hostId !== userId) {
      const host = db.prepare('SELECT id, notifyOnInterest FROM users WHERE id = ?').get(opp.hostId) as any;
      if (host?.notifyOnInterest) {
        const volunteer = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
        db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
          randomUUID(), opp.hostId, 'interest', `${volunteer?.username || 'Someone'} committed to "${opp.title}"`, oppId, now
        );
      }
    }

    return res.json({ committed: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** Anytime, no cutoff — the org just sees the roster change. Doesn't touch
 * the underlying Interested signup, only the commitment layered on top. */
router.delete('/api/opportunities/:id/signup/commit', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.id;
    const userId = req.userId!;
    db.prepare('UPDATE signups SET committedAt = NULL WHERE opportunityId = ? AND userId = ?').run(oppId, userId);
    return res.json({ committed: false });
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
    const signupRows = db.prepare('SELECT userId, committedAt FROM signups WHERE opportunityId = ?').all(oppId) as any[];
    const signups = signupRows.map(s => s.userId);
    const committed = signupRows.filter(s => s.committedAt).map(s => s.userId);
    return res.json(withTags(updated, signups, committed));
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

    const { title, description, category, location, town, date, duration, spots, spotsType, image, tags, isAvailable, isRecurring, recurringDay, recurringTime, cardObjectPosition, modalObjectPosition, externalSignupUrl } = req.body;

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
    // Never required — validated only when a non-blank value was sent; a blank value clears it to null
    let trimmedSignupUrl: string | undefined;
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
      if (isRecurring !== undefined) db.prepare('UPDATE opportunities SET isRecurring = ? WHERE id = ?').run(isRecurring ? 1 : 0, oppId);
      if (recurringDay   !== undefined) db.prepare('UPDATE opportunities SET recurringDay = ? WHERE id = ?').run(Number(recurringDay), oppId);
      if (recurringTime  !== undefined) db.prepare('UPDATE opportunities SET recurringTime = ? WHERE id = ?').run(recurringTime, oppId);
      if (cardObjectPosition  !== undefined) db.prepare('UPDATE opportunities SET cardObjectPosition = ? WHERE id = ?').run(cardObjectPosition || null, oppId);
      if (modalObjectPosition !== undefined) db.prepare('UPDATE opportunities SET modalObjectPosition = ? WHERE id = ?').run(modalObjectPosition || null, oppId);
      if (trimmedSignupUrl    !== undefined) db.prepare('UPDATE opportunities SET externalSignupUrl = ? WHERE id = ?').run(trimmedSignupUrl || null, oppId);
    })();

    const updated = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    const signupRows = db.prepare('SELECT userId, committedAt FROM signups WHERE opportunityId = ?').all(oppId) as any[];
    const signups = signupRows.map(s => s.userId);
    const committed = signupRows.filter(s => s.committedAt).map(s => s.userId);
    return res.json(withTags(updated, signups, committed));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete own opportunity (host or admin)
/** Everything the tracker attached to an event. Foreign keys point at
 * opportunities from four directions now, so any delete path that predates
 * the tracker fails with a raw constraint error unless it clears these
 * first. Callers decide the policy (refuse vs proceed); this only does the
 * clearing. */
function purgeTrackerData(oppId: string) {
  db.prepare('DELETE FROM attendance WHERE opportunityId = ?').run(oppId);
  db.prepare('DELETE FROM attendance_segments WHERE opportunityId = ?').run(oppId);
  db.prepare(
    'DELETE FROM session_pauses WHERE sessionId IN (SELECT id FROM event_sessions WHERE opportunityId = ?)'
  ).run(oppId);
  db.prepare('DELETE FROM event_sessions WHERE opportunityId = ?').run(oppId);
}

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

    // Verified hours live on volunteers' profiles and may already sit behind
    // an issued certificate, so deleting the event would take those with it.
    // Refuse and point at closing, which is what retiring an old event
    // actually means. Previously the foreign keys refused for us and the
    // organizer just saw "FOREIGN KEY constraint failed".
    const credited = (db.prepare(
      "SELECT COUNT(DISTINCT userId) as c FROM attendance WHERE opportunityId = ? AND status = 'credited'"
    ).get(oppId) as any).c;
    if (credited > 0) {
      return res.status(409).json({
        error: `This event has verified hours for ${credited} ${credited === 1 ? 'volunteer' : 'volunteers'}, so it can't be deleted. Close it instead — it stops taking sign-ups and their hours stay on their profiles.`,
      });
    }

    db.transaction(() => {
      purgeTrackerData(oppId);
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
    const favorites = db.prepare(`
      SELECT u.id, u.username, u.email, u.accountType, u.createdAt
      FROM favorites f
      JOIN users u ON f.orgId = u.id
      WHERE f.userId = ?
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

    const org = db.prepare('SELECT id FROM users WHERE id = ?').get(orgId);
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
    const users = db.prepare(
      'SELECT id, username, email, isAdmin, accountType, banned, verified, createdAt FROM users ORDER BY createdAt DESC'
    ).all();
    return res.json((users as any[]).map(u => ({ ...u, isAdmin: !!u.isAdmin, banned: !!u.banned, verified: !!u.verified })));
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
        purgeTrackerData(oppId);
        db.prepare('DELETE FROM signups WHERE opportunityId = ?').run(oppId);
        db.prepare('DELETE FROM reports WHERE postId = ?').run(oppId);
      }
      // Their own attendance at OTHER organizations' events, plus any
      // certificate applications either side of the relationship.
      db.prepare('DELETE FROM attendance WHERE userId = ?').run(userId);
      db.prepare('DELETE FROM attendance_segments WHERE userId = ?').run(userId);
      db.prepare('DELETE FROM certificate_applications WHERE userId = ? OR hostId = ?').run(userId, userId);
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
    const signupRows = db.prepare('SELECT userId, committedAt FROM signups WHERE opportunityId = ?').all(oppId) as any[];
    const signups = signupRows.map(s => s.userId);
    const committed = signupRows.filter(s => s.committedAt).map(s => s.userId);
    return res.json(withTags(updated, signups, committed));
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
    // organization's own delete it proceeds even when hours exist — but it
    // has to clear the tracker rows itself or the foreign keys reject it.
    db.transaction(() => {
      purgeTrackerData(oppId);
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
    const getSignups = db.prepare('SELECT userId, committedAt FROM signups WHERE opportunityId = ?');
    const result = (pending as any[]).map(opp =>
      withTags(opp, (getSignups.all(opp.id) as any[]).map((s: any) => s.userId),
        (getSignups.all(opp.id) as any[]).filter((s: any) => s.committedAt).map((s: any) => s.userId))
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
    const signupRows = db.prepare('SELECT userId, committedAt FROM signups WHERE opportunityId = ?').all(oppId) as any[];
    const signups = signupRows.map((s: any) => s.userId);
    const committed = signupRows.filter((s: any) => s.committedAt).map((s: any) => s.userId);
    return res.json(withTags(updated, signups, committed));
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

// ===== CERTIFICATE REVIEW (organization) =====
// Namespaced under /api/my-org rather than /api/org because /api/org/:id is
// the public organization profile and would match a literal path segment
// first, resolving "certificate-applications" as an organization id.
// The certificate reads "verified volunteer service with <Org>", so the
// organization confirms before it ever reaches an admin. They're confirming
// something they already caused — these are hours they credited — so this
// is a check, not a fresh judgement.
router.get('/api/my-org/certificate-applications', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(
      `SELECT c.*, v.username as volunteerName
       FROM certificate_applications c
       JOIN users v ON v.id = c.userId
       WHERE c.hostId = ? AND c.status = 'pending_org'
       ORDER BY c.createdAt ASC`
    ).all(req.userId!) as any[];
    return res.json(rows.map(r => ({
      ...r,
      currentHours: Math.round(hoursWithOrg(r.userId, r.hostId) * 100) / 100,
    })));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/my-org/certificate-applications/:id/approve', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const row = db.prepare('SELECT * FROM certificate_applications WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Application not found' });
    if (row.hostId !== req.userId) return res.status(403).json({ error: 'This request is for a different organization' });
    if (row.status !== 'pending_org') return res.status(400).json({ error: 'Already reviewed' });

    const hours = hoursWithOrg(row.userId, row.hostId);
    if (hours < row.tier) {
      return res.status(409).json({ error: `${Math.round(hours * 10) / 10} verified hours now — ${row.tier} required.` });
    }
    db.prepare("UPDATE certificate_applications SET status = 'pending_admin' WHERE id = ?").run(row.id);
    return res.json({ id: row.id, status: 'pending_admin' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/my-org/certificate-applications/:id/decline', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const row = db.prepare('SELECT * FROM certificate_applications WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Application not found' });
    if (row.hostId !== req.userId) return res.status(403).json({ error: 'This request is for a different organization' });
    if (row.status !== 'pending_org') return res.status(400).json({ error: 'Already reviewed' });

    const note = typeof (req.body || {}).note === 'string' ? String(req.body.note).slice(0, 300) : null;
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE certificate_applications SET status = 'declined', note = ?, decidedBy = ?, decidedAt = ? WHERE id = ?"
    ).run(note, req.userId, now, row.id);
    db.prepare('INSERT INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)').run(
      randomUUID(), row.userId, 'certificate_declined',
      `Your ${row.tier}-hour certificate request wasn't approved by the organization${note ? `: ${note}` : ''}`, now
    );
    return res.json({ id: row.id, status: 'declined' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== CERTIFICATE REVIEW (admin) =====
// currentHours is recomputed at read time rather than trusting the snapshot
// taken when the volunteer applied, so an admin is always deciding on the
// hours that exist right now — a credit revoked since then shows up here.
router.get('/api/admin/certificate-applications', requireAdmin, (_req: Request, res: Response) => {
  try {
    const rows = db.prepare(
      `SELECT c.*, v.username as volunteerName, v.email as volunteerEmail, o.username as orgName
       FROM certificate_applications c
       JOIN users v ON v.id = c.userId
       JOIN users o ON o.id = c.hostId
       WHERE c.status = 'pending_admin'
       ORDER BY c.createdAt ASC`
    ).all() as any[];
    return res.json(rows.map(r => ({
      ...r,
      currentHours: Math.round(hoursWithOrg(r.userId, r.hostId) * 100) / 100,
    })));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/certificate-applications/:id/issue', requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const row = db.prepare('SELECT * FROM certificate_applications WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Application not found' });
    if (row.status !== 'pending_admin') {
      return res.status(400).json({
        error: row.status === 'pending_org' ? 'Still waiting on the organization' : 'Already reviewed',
      });
    }

    // Re-check at the moment of issuing. Hours can be revoked between
    // applying and reviewing, and a certificate must never outlive the
    // attendance it was based on.
    const hours = hoursWithOrg(row.userId, row.hostId);
    if (hours < row.tier) {
      return res.status(409).json({
        error: `No longer eligible — ${Math.round(hours * 10) / 10} verified hours now, ${row.tier} required.`,
      });
    }

    const now = new Date().toISOString();
    db.prepare(
      "UPDATE certificate_applications SET status = 'issued', decidedBy = ?, decidedAt = ? WHERE id = ?"
    ).run(req.userId, now, row.id);

    const org = db.prepare('SELECT username FROM users WHERE id = ?').get(row.hostId) as any;
    db.prepare('INSERT INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)').run(
      randomUUID(), row.userId, 'certificate_issued',
      `Your ${row.tier}-hour certificate with ${org?.username ?? 'an organization'} has been issued`, now
    );
    return res.json({ id: row.id, status: 'issued' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/admin/certificate-applications/:id/decline', requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const row = db.prepare('SELECT * FROM certificate_applications WHERE id = ?').get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Application not found' });
    if (row.status !== 'pending_admin') {
      return res.status(400).json({
        error: row.status === 'pending_org' ? 'Still waiting on the organization' : 'Already reviewed',
      });
    }

    const note = typeof (req.body || {}).note === 'string' ? String(req.body.note).slice(0, 300) : null;
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE certificate_applications SET status = 'declined', note = ?, decidedBy = ?, decidedAt = ? WHERE id = ?"
    ).run(note, req.userId, now, row.id);

    db.prepare('INSERT INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)').run(
      randomUUID(), row.userId, 'certificate_declined',
      `Your ${row.tier}-hour certificate application wasn't approved${note ? `: ${note}` : ''}`, now
    );
    return res.json({ id: row.id, status: 'declined' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/admin/analytics', requireAdmin, (req: Request, res: Response) => {
  try {
    const ALLOWED_DAYS = [7, 14, 30, 365];
    const requested = parseInt(req.query.days as string, 10);
    const numDays = ALLOWED_DAYS.includes(requested) ? requested : 14;

    const days: { date: string; signups: number; users: number }[] = [];
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const signups = db.prepare("SELECT COUNT(*) as count FROM signups WHERE date(createdAt) = ?").get(dateStr) as any;
      const users   = db.prepare("SELECT COUNT(*) as count FROM users   WHERE date(createdAt) = ?").get(dateStr) as any;
      days.push({ date: dateStr, signups: signups.count, users: users.count });
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
  return res.json({ url: `/uploads/${req.file.filename}` });
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
    const getSignups = db.prepare('SELECT userId, committedAt FROM signups WHERE opportunityId = ?');
    const result = posts.map(opp =>
      withTags(opp, (getSignups.all(opp.id) as any[]).map((s: any) => s.userId),
        (getSignups.all(opp.id) as any[]).filter((s: any) => s.committedAt).map((s: any) => s.userId))
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
    const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
    const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();
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

// ===== TRACKER (attendance / hour verification) =====
// A signup means "tapped Interested." Attendance means "scanned at the
// event." The roster merges both: a signup with no scan shows as Pending
// (session still ahead) or No-show (session's over) — derived at read time
// from a row simply not existing, never stored, so there's nothing to keep
// in sync or clean up.
//
// One scan credits the event's FULL listed duration immediately — no timer,
// no second scan, nothing that can get stuck half-finished. That's a
// deliberate trade against precision: someone who leaves after twenty
// minutes still gets full credit unless the host manually adjusts it (the
// same adjust action they'd use for any other correction). The earlier
// version of this measured real elapsed time between two scans, which
// meant a live clock, a second scan to remember, and a sweep to catch
// whoever forgot — three moving parts in exchange for precision most hour-
// verification tools don't bother with either. Simplicity won.
//
// The integrity control is a time-gate on check-in (scanning only works in
// the session's actual window, so a photographed poster is worthless
// outside it) plus the host's standing ability to adjust or revoke
// afterward — not a pre-approval step.

/** The date (YYYY-MM-DD) of the session happening right now, or the one most
 * recently ended. For a one-time event that's just the event's own date. For
 * a recurring one, getRecurringStatus() only looks forward to the *next*
 * occurrence, which is useless at the event itself — this looks backward to
 * the most recent occurrence of recurringDay, so a weekly event gets a fresh
 * check-in every week instead of the unique constraint permanently claiming
 * it for whoever showed up first. */
function currentOccurrenceDate(opp: { date: string; isRecurring?: number | boolean; recurringDay?: number | null }): string {
  if (!opp.isRecurring || opp.recurringDay === null || opp.recurringDay === undefined) {
    return opp.date.slice(0, 10);
  }
  const now = new Date();
  const diff = (now.getDay() - opp.recurringDay + 7) % 7;
  const occ = new Date(now);
  occ.setDate(now.getDate() - diff);
  return localDateString(occ);
}

/** YYYY-MM-DD in the server's own timezone. toISOString().slice(0,10) gives
 * the UTC date, which past early evening in the Americas is already
 * tomorrow — enough to file an evening event's roster under the wrong day. */
function localDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Which occurrence a live action belongs to.
 *
 * A recurring event normally snaps to its most recent recurring weekday. But
 * an organizer running an extra session on some other day would otherwise
 * write straight into last week's roster — same key, same unique constraint.
 * So if a session already exists for today, today is the occurrence. */
function activeOccurrenceDate(opp: any): string {
  const snapped = currentOccurrenceDate(opp);
  if (!opp.isRecurring) return snapped;
  const today = localDateString(new Date());
  if (today === snapped) return snapped;
  const todaySession = db.prepare(
    'SELECT 1 FROM event_sessions WHERE opportunityId = ? AND occurrenceDate = ?'
  ).get(opp.id, today);
  return todaySession ? today : snapped;
}

/** Start/end instants for one occurrence — the only thing check-in gating
 * and no-show/auto-close derivation need. Local server time throughout; see
 * the ponytail note below on why that's a deliberately bounded gap. */
function occurrenceWindow(opp: { date: string; duration: number; isRecurring?: number | boolean; recurringTime?: string | null }, occurrenceDate: string): { start: Date; end: Date } {
  let start: Date;
  if (opp.isRecurring && opp.recurringTime) {
    const [h, m] = opp.recurringTime.split(':').map(Number);
    start = new Date(`${occurrenceDate}T00:00:00`);
    start.setHours(h, m, 0, 0);
  } else {
    start = new Date(opp.date);
  }
  return { start, end: new Date(start.getTime() + opp.duration * 3_600_000) };
}

// 'requested' is the volunteer's own claim that they were there but never
// scanned — it carries no hours until a host approves it, so it can never
// inflate a profile on its own.
const VALID_ATTENDANCE_DECISIONS = ['credited', 'rejected'] as const;

type SessionStatus = 'none' | 'scheduled' | 'running' | 'paused' | 'stopped';

/** The org's live session for one occurrence, plus its pause intervals. */
function getSession(oppId: string, occurrenceDate: string) {
  const session = db.prepare(
    'SELECT * FROM event_sessions WHERE opportunityId = ? AND occurrenceDate = ?'
  ).get(oppId, occurrenceDate) as any;
  if (!session) return null;
  const pauses = db.prepare(
    'SELECT * FROM session_pauses WHERE sessionId = ? ORDER BY pausedAt ASC'
  ).all(session.id) as any[];
  return { ...session, pauses };
}

/** Status is computed on every read rather than written by a background job.
 * A scheduled autoStartAt that's now in the past reads as running; an
 * autoStopAt in the past reads as stopped. That's the whole of auto-start
 * and auto-stop — no cron, nothing to miss if the process restarts. */
function sessionStatus(session: any, now = Date.now()): SessionStatus {
  if (!session) return 'none';
  if (session.stoppedAt) return 'stopped';
  if (new Date(session.autoStopAt).getTime() <= now) return 'stopped';
  if (!session.startedAt) {
    if (!session.autoStartAt || new Date(session.autoStartAt).getTime() > now) return 'scheduled';
  }
  return session.pauses.some((p: any) => !p.resumedAt) ? 'paused' : 'running';
}

/** When the session actually ended, for closing open segments: whichever
 * came first, the org pressing Stop or autoStopAt passing. An open segment
 * is never credited past that instant. */
function sessionEndedAt(session: any): number {
  const auto = new Date(session.autoStopAt).getTime();
  return session.stoppedAt ? Math.min(new Date(session.stoppedAt).getTime(), auto) : auto;
}

/** Hours for one volunteer across all their segments in an occurrence.
 *
 * Pauses are subtracted per segment by overlap, not as a flat total — that
 * distinction is the whole reason pauses are stored as intervals. Someone
 * who arrives after the lunch break loses nothing to it; someone who was
 * present through it loses exactly its length.
 *
 * An open segment (scanned in, never out) is measured to `openUntil`, which
 * the caller sets to now for a live session or to the session's end once
 * it's over — so forgetting to scan out costs nothing beyond the event.
 */
function segmentHours(segments: any[], pauses: any[], openUntil: number): number {
  let ms = 0;
  for (const s of segments) {
    const start = new Date(s.checkInAt).getTime();
    const end = s.checkOutAt ? new Date(s.checkOutAt).getTime() : openUntil;
    let span = end - start;
    for (const p of pauses) {
      const pStart = new Date(p.pausedAt).getTime();
      const pEnd = p.resumedAt ? new Date(p.resumedAt).getTime() : openUntil;
      const overlap = Math.min(end, pEnd) - Math.max(start, pStart);
      if (overlap > 0) span -= overlap;
    }
    ms += Math.max(0, span);
  }
  return ms / 3_600_000;
}

/** Segments for one person in one occurrence, oldest first. */
function getSegments(oppId: string, userId: string, occurrenceDate: string) {
  return db.prepare(
    'SELECT * FROM attendance_segments WHERE opportunityId = ? AND userId = ? AND occurrenceDate = ? ORDER BY checkInAt ASC'
  ).all(oppId, userId, occurrenceDate) as any[];
}

/** Recompute the attendance summary row from the raw segments. Every other
 * reader — roster, CSV export, the profile hours total — goes through
 * attendance, so this is the one place segments turn into credited hours. */
function syncAttendance(oppId: string, userId: string, occurrenceDate: string, session: any) {
  const segments = getSegments(oppId, userId, occurrenceDate);
  if (!segments.length) return null;
  const live = sessionStatus(session) === 'running' || sessionStatus(session) === 'paused';
  const openUntil = live ? Date.now() : sessionEndedAt(session);
  const hours = Math.round(segmentHours(segments, session.pauses, openUntil) * 100) / 100;

  const existing = db.prepare(
    'SELECT * FROM attendance WHERE opportunityId = ? AND userId = ? AND occurrenceDate = ?'
  ).get(oppId, userId, occurrenceDate) as any;
  const now = new Date().toISOString();

  // A deliberate host decision sticks: an explicit hour figure or a revoked
  // credit must not be silently overwritten by later scan activity. This is
  // keyed on hoursLocked rather than verifiedBy on purpose — "mark as came"
  // also stamps verifiedBy, and locking on that would mean someone marked
  // present by hand could never have their real scanned hours land.
  if (existing?.hoursLocked) return existing;

  if (existing) {
    db.prepare('UPDATE attendance SET checkInAt = ?, checkOutAt = ?, hoursClaimed = ?, hoursVerified = ? WHERE id = ?')
      .run(segments[0].checkInAt, segments[segments.length - 1].checkOutAt, hours, hours, existing.id);
  } else {
    db.prepare(
      `INSERT INTO attendance (id, opportunityId, userId, occurrenceDate, checkInAt, checkOutAt, hoursClaimed, hoursVerified, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'credited', ?)`
    ).run(randomUUID(), oppId, userId, occurrenceDate, segments[0].checkInAt, segments[segments.length - 1].checkOutAt, hours, hours, now);
  }
  const opp = db.prepare('SELECT hostId FROM opportunities WHERE id = ?').get(oppId) as any;
  if (opp?.hostId) notifyMilestones(userId, opp.hostId);
  return db.prepare('SELECT * FROM attendance WHERE opportunityId = ? AND userId = ? AND occurrenceDate = ?').get(oppId, userId, occurrenceDate);
}

/** Finalize a session that has ended.
 *
 * Auto-stop is derived, not scheduled — nothing fires when autoStopAt
 * passes — so without this, a volunteer who scanned in and never scanned
 * out kept the hours written at scan-in, which is zero. They attended the
 * whole event and their profile said 0. This is the repair, run lazily on
 * the first read after the session ends.
 *
 * Open segments close at whichever came first, the org pressing Stop or
 * autoStopAt passing, so an organizer who forgets to stop until the next
 * morning doesn't hand everyone an extra twelve hours.
 *
 * Idempotent, and cheap to call repeatedly: it bails immediately once
 * there's nothing left open, which matters because the tracker polls.
 */
function reconcileSession(oppId: string, occurrenceDate: string, session: any) {
  if (!session || sessionStatus(session) !== 'stopped') return;

  const openSegments = (db.prepare(
    'SELECT COUNT(*) as c FROM attendance_segments WHERE opportunityId = ? AND occurrenceDate = ? AND checkOutAt IS NULL'
  ).get(oppId, occurrenceDate) as any).c;
  const openPause = session.pauses.find((p: any) => !p.resumedAt);
  if (!openSegments && !openPause) return; // already reconciled

  const endedAt = new Date(sessionEndedAt(session)).toISOString();
  if (openPause) {
    db.prepare('UPDATE session_pauses SET resumedAt = ? WHERE id = ?').run(endedAt, openPause.id);
  }
  if (openSegments) {
    db.prepare(
      'UPDATE attendance_segments SET checkOutAt = ? WHERE opportunityId = ? AND occurrenceDate = ? AND checkOutAt IS NULL'
    ).run(endedAt, oppId, occurrenceDate);
  }

  const fresh = getSession(oppId, occurrenceDate);
  const attendees = db.prepare(
    'SELECT DISTINCT userId FROM attendance_segments WHERE opportunityId = ? AND occurrenceDate = ?'
  ).all(oppId, occurrenceDate) as any[];
  for (const a of attendees) syncAttendance(oppId, a.userId, occurrenceDate, fresh);
}

/** Close out any of this volunteer's own open segments whose session has
 * already ended. The profile total reads the attendance table, so without
 * this a forgotten scan-out shows as zero hours on their own page until
 * some organizer happens to open the roster. Bounded — only touches rows
 * that are actually still open. */
function reconcileUserSegments(userId: string) {
  const open = db.prepare(
    'SELECT DISTINCT opportunityId, occurrenceDate FROM attendance_segments WHERE userId = ? AND checkOutAt IS NULL'
  ).all(userId) as any[];
  for (const o of open) {
    reconcileSession(o.opportunityId, o.occurrenceDate, getSession(o.opportunityId, o.occurrenceDate));
  }
}

/** The tracker roster for one occurrence: every COMMITTED signup — Interested
 * alone doesn't appear here, that's the whole point of the extra step — left-
 * joined to an attendance summary row if one exists.
 *
 * "Didn't come" requires a session to have actually run and ended. A
 * committed volunteer at an event nobody ever started is simply undecided,
 * not absent — the earlier version of this derived no-show purely from the
 * posted end time passing, which meant an org that hadn't opened the
 * Tracker yet saw its own volunteers marked absent. */
function getMergedRoster(oppId: string, occurrenceDate: string, session: any, listedDuration = 0) {
  const status = sessionStatus(session);
  const sessionRanAndEnded = status === 'stopped';
  // Anyone whose segment closed exactly when the session ended was still on
  // site when the clock ran out — their real hours may be higher than what
  // was credited, and only the organizer can know.
  const endedAtIso = session && sessionRanAndEnded ? new Date(sessionEndedAt(session)).toISOString() : null;
  const rows = db.prepare(
    `SELECT u.id as userId, u.username, u.email, s.committedAt,
            a.id as attendanceId, a.checkInAt, a.checkOutAt, a.hoursClaimed, a.hoursVerified, a.status as attStatus, a.note, a.hoursLocked
     FROM signups s
     JOIN users u ON u.id = s.userId
     LEFT JOIN attendance a ON a.opportunityId = s.opportunityId AND a.userId = s.userId AND a.occurrenceDate = ?
     WHERE s.opportunityId = ? AND s.committedAt IS NOT NULL
     ORDER BY s.committedAt ASC`
  ).all(occurrenceDate, oppId) as any[];

  const live = status === 'running' || status === 'paused';
  const roster = rows.map(r => {
    if (r.attStatus === 'rejected') return { ...r, status: 'rejected' as const, hoursNow: 0, cutShort: false, overListed: false };
    // Claimed attendance awaiting a decision. Sorted to the top below,
    // because it's the only row type that needs the organizer to act.
    if (r.attStatus === 'requested') return { ...r, status: 'requested' as const, hoursNow: 0, cutShort: false, overListed: false };
    const openSegment = r.attendanceId && !r.checkOutAt && r.checkInAt;
    let derived: 'coming' | 'here' | 'left' | 'no_show';
    if (openSegment) derived = 'here';
    else if (r.attendanceId) derived = 'left';
    else derived = sessionRanAndEnded ? 'no_show' : 'coming';

    // While the event is running, the stored total is only as fresh as that
    // person's last scan — someone still on site has been accruing time
    // since. Recomputed for display so the organizer sees what's true right
    // now, without writing on every roster poll.
    let hoursNow = r.hoursVerified ?? r.hoursClaimed ?? 0;
    if (live && derived === 'here') {
      const segs = getSegments(oppId, r.userId, occurrenceDate);
      hoursNow = Math.round(segmentHours(segs, session.pauses, Date.now()) * 100) / 100;
    }
    // Two things worth an organizer's eye: hours cut short because the
    // session ended while they were still checked in, and hours that ran
    // past what the event was advertised as.
    const cutShort = !!endedAtIso && r.checkOutAt === endedAtIso && !r.hoursLocked;
    const overListed = listedDuration > 0 && hoursNow > listedDuration + 0.01;
    return { ...r, status: derived, hoursNow, cutShort, overListed };
  });
  // Anything waiting on the organizer floats to the top — it's the only
  // part of this list that's a task rather than a record.
  roster.sort((a, b) => Number(b.status === 'requested') - Number(a.status === 'requested'));
  return { sessionStatus: status, roster };
}

// What the check-in page reads on load, before anyone taps anything — so it
// can show "the organizer hasn't started this yet", a running clock, or an
// already-finished total immediately rather than only after a failed tap.
router.get('/api/checkin/:opportunityId/status', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.opportunityId;
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    const occurrenceDate = activeOccurrenceDate(opp);
    // If the session ended while this volunteer was still checked in, this
    // is where their hours actually get finalized — they're often the first
    // person to look after an event.
    reconcileSession(oppId, occurrenceDate, getSession(oppId, occurrenceDate));

    const session = getSession(oppId, occurrenceDate);
    const status = sessionStatus(session);
    const segments = getSegments(oppId, req.userId!, occurrenceDate);
    const openSegment = segments.find(s => !s.checkOutAt) || null;
    const attendance = db.prepare(
      'SELECT * FROM attendance WHERE opportunityId = ? AND userId = ? AND occurrenceDate = ?'
    ).get(oppId, req.userId, occurrenceDate) as any || null;
    const signup = db.prepare('SELECT * FROM signups WHERE opportunityId = ? AND userId = ?').get(oppId, req.userId) as any;

    const live = status === 'running' || status === 'paused';
    const openUntil = session ? (live ? Date.now() : sessionEndedAt(session)) : Date.now();
    const rawHours = session ? segmentHours(segments, session.pauses, openUntil) : 0;
    // Once a host has set a figure by hand, that's the number the volunteer
    // is actually getting — showing them the raw scan math instead would be
    // a different number from the one on their profile.
    const hoursSoFar = attendance?.hoursLocked ? (attendance.hoursVerified ?? 0) : rawHours;

    return res.json({
      occurrenceDate,
      sessionStatus: status,
      autoStopAt: session?.autoStopAt ?? null,
      autoStartAt: session?.autoStartAt ?? null,
      startedAt: session?.startedAt ?? session?.autoStartAt ?? null,
      // Whether a code is needed — never the code itself. Returning it here
      // would hand it to exactly the remote scanner it exists to stop.
      pinRequired: !!session?.checkinPin && !openSegment,
      checkedIn: !!openSegment,
      openSince: openSegment?.checkInAt ?? null,
      segments: segments.length,
      hoursSoFar: Math.round(hoursSoFar * 100) / 100,
      hoursLocked: !!attendance?.hoursLocked,
      signedUp: !!signup,
      committed: !!signup?.committedAt,
      attendance,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** One endpoint for both scans, because it's one physical action: the
 * volunteer points their camera at the same code either way. An open
 * segment closes; no open segment opens a new one. Leaving and coming back
 * just makes more segments, and they're allowed for as long as the org's
 * session runs. */
router.post('/api/checkin/:opportunityId', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.opportunityId;
    const userId = req.userId!;
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    const occurrenceDate = activeOccurrenceDate(opp);
    const now = new Date();
    let session = getSession(oppId, occurrenceDate);
    let status = sessionStatus(session);

    // The org never touched this event's session at all — nobody pressed
    // Start, nobody scheduled one. Rather than lock everyone out over a
    // forgotten button, the first scan opens it, auto-stop defaulting to
    // the listed duration. The org keeps full pause/stop control from there.
    //
    // A 'scheduled' session is deliberately NOT included here: the org set
    // a future start time on purpose, and an early scan must not be able to
    // preempt it — the whole point of the org running the clock is that
    // volunteers don't get to decide when their own hours start.
    if (status === 'none') {
      db.prepare(
        `INSERT INTO event_sessions (id, opportunityId, occurrenceDate, startedAt, autoStopAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(randomUUID(), oppId, occurrenceDate, now.toISOString(),
            new Date(now.getTime() + (opp.duration || 3) * 3_600_000).toISOString(), now.toISOString());
      session = getSession(oppId, occurrenceDate);
      status = sessionStatus(session);
    }

    if (status === 'scheduled') {
      return res.status(403).json({
        error: `${opp.hostName} scheduled this to start at ${new Date(session.autoStartAt).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}.`,
        opensAt: session.autoStartAt,
      });
    }
    if (status === 'stopped') {
      return res.status(403).json({ error: 'The organizer has ended this session.' });
    }
    if (status === 'paused') {
      return res.status(403).json({ error: 'The organizer paused this event — try again once it resumes.' });
    }

    // The code is only ever displayed on the organizer's screen, so needing
    // it means being in the room. Checked on the way in only — someone
    // already checked in can always scan out without hunting for it again.
    const open = getSegments(oppId, userId, occurrenceDate).find(s => !s.checkOutAt);
    if (session.checkinPin && !open) {
      const supplied = String((req.body || {}).pin ?? '').trim();
      if (supplied !== session.checkinPin) {
        return res.status(403).json({
          error: supplied ? "That code doesn't match." : 'Enter the code shown by the organizer.',
          pinRequired: true,
        });
      }
    }

    if (open) {
      db.prepare('UPDATE attendance_segments SET checkOutAt = ? WHERE id = ?').run(now.toISOString(), open.id);
    } else {
      // Walk-in: scanning in place of pressing Committed first. One action
      // does both, so nobody has to work out which button to press standing
      // at the door.
      const signup = db.prepare('SELECT * FROM signups WHERE opportunityId = ? AND userId = ?').get(oppId, userId) as any;
      if (!signup) {
        db.prepare('INSERT INTO signups (opportunityId, userId, committedAt, createdAt) VALUES (?, ?, ?, ?)')
          .run(oppId, userId, now.toISOString(), now.toISOString());
        db.prepare('UPDATE opportunities SET popularity = popularity + 1 WHERE id = ?').run(oppId);
      } else if (!signup.committedAt) {
        db.prepare('UPDATE signups SET committedAt = ? WHERE id = ?').run(now.toISOString(), signup.id);
      }
      db.prepare(
        `INSERT INTO attendance_segments (id, opportunityId, userId, occurrenceDate, checkInAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(randomUUID(), oppId, userId, occurrenceDate, now.toISOString(), now.toISOString());

      // Bell only, no email — per-scan emails don't scale against the
      // provider's daily cap. The bell is free, so no reason to withhold it.
      if (opp.hostId !== userId) {
        const host = db.prepare('SELECT id, notifyOnInterest FROM users WHERE id = ?').get(opp.hostId) as any;
        if (host?.notifyOnInterest) {
          const volunteer = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
          db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
            randomUUID(), opp.hostId, 'hours_credited', `${volunteer?.username || 'Someone'} checked in to "${opp.title}"`, oppId, now.toISOString()
          );
        }
      }
    }

    const attendance = syncAttendance(oppId, userId, occurrenceDate, getSession(oppId, occurrenceDate));
    const segments = getSegments(oppId, userId, occurrenceDate);
    return res.json({
      checkedIn: !open,
      hoursSoFar: attendance?.hoursVerified ?? 0,
      segments: segments.length,
      attendance,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== SESSION CONTROLS (organization side) =====
// The org drives the clock. A posted end time is often a guess, so rather
// than trusting it, these let the organizer start, pause, resume and stop
// the real thing — and the volunteers' hours follow it exactly.

function requireHost(oppId: string, req: AuthRequest) {
  const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
  if (!opp) return { error: 'Opportunity not found', code: 404 as const, opp: null };
  if (opp.hostId !== req.userId && !req.isAdmin) return { error: 'Only the host can run this event', code: 403 as const, opp: null };
  return { error: null, code: 200 as const, opp };
}

router.get('/api/opportunities/:id/session', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const { error, code, opp } = requireHost(req.params.id, req);
    if (error) return res.status(code).json({ error });
    const occurrenceDate = activeOccurrenceDate(opp);
    const session = getSession(opp.id, occurrenceDate);
    return res.json({ occurrenceDate, status: sessionStatus(session), session });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** Start now, or schedule an automatic start. autoStopAt is required either
 * way — that's the promise that no volunteer's clock runs forever if the
 * organizer walks off at the end of the day. */
router.post('/api/opportunities/:id/session/start', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const { error, code, opp } = requireHost(req.params.id, req);
    if (error) return res.status(code).json({ error });
    const { autoStopAt, autoStartAt } = req.body || {};
    if (typeof autoStopAt !== 'string' || isNaN(Date.parse(autoStopAt))) {
      return res.status(400).json({ error: 'autoStopAt is required' });
    }
    if (autoStartAt !== undefined && autoStartAt !== null && isNaN(Date.parse(autoStartAt))) {
      return res.status(400).json({ error: 'autoStartAt must be a valid time' });
    }
    if (Date.parse(autoStopAt) <= Date.now()) {
      return res.status(400).json({ error: 'The stop time is already in the past' });
    }
    if (autoStartAt && Date.parse(autoStopAt) <= Date.parse(autoStartAt)) {
      return res.status(400).json({ error: 'The stop time must be after the start time' });
    }

    // An optional short code, shown only on the organizer's own screen.
    const { requirePin } = req.body || {};

    // A recurring event running on an off-day files under TODAY rather than
    // snapping back to its usual weekday — otherwise an extra Wednesday
    // session would write straight into last Saturday's roster.
    const occurrenceDate = opp.isRecurring ? localDateString(new Date()) : activeOccurrenceDate(opp);
    const now = new Date().toISOString();
    const existing = getSession(opp.id, occurrenceDate);
    const pin = requirePin
      ? (existing?.checkinPin || String(Math.floor(1000 + Math.random() * 9000)))
      : null;
    // Restarting a stopped session reopens it rather than making a second
    // one — the unique constraint is per occurrence, and an event that ran
    // long shouldn't fragment into two rosters. But this endpoint doubles as
    // "just extend the stop time" on a session that's already running or
    // paused, and that path must NOT stomp startedAt — resetting it would
    // misreport when the event actually began even though it doesn't
    // corrupt any volunteer's already-recorded segments. Only a genuine
    // (re)start — currently stopped, or never started at all — gets a fresh
    // startedAt.
    if (existing) {
      const genuineRestart = sessionStatus(existing) === 'stopped' || !existing.startedAt;
      const newStartedAt = genuineRestart ? (autoStartAt ? null : now) : existing.startedAt;
      db.prepare('UPDATE event_sessions SET autoStopAt = ?, autoStartAt = ?, startedAt = ?, stoppedAt = NULL, startedBy = ?, checkinPin = ? WHERE id = ?')
        .run(autoStopAt, autoStartAt ?? null, newStartedAt, req.userId, pin, existing.id);
    } else {
      db.prepare(
        `INSERT INTO event_sessions (id, opportunityId, occurrenceDate, autoStartAt, startedAt, autoStopAt, startedBy, checkinPin, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(randomUUID(), opp.id, occurrenceDate, autoStartAt ?? null, autoStartAt ? null : now, autoStopAt, req.userId, pin, now);
    }
    const session = getSession(opp.id, occurrenceDate);
    return res.json({ occurrenceDate, status: sessionStatus(session), session });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/opportunities/:id/session/pause', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const { error, code, opp } = requireHost(req.params.id, req);
    if (error) return res.status(code).json({ error });
    const occurrenceDate = activeOccurrenceDate(opp);
    const session = getSession(opp.id, occurrenceDate);
    if (sessionStatus(session) !== 'running') return res.status(400).json({ error: 'This event is not running' });
    db.prepare('INSERT INTO session_pauses (id, sessionId, pausedAt) VALUES (?, ?, ?)')
      .run(randomUUID(), session.id, new Date().toISOString());
    const updated = getSession(opp.id, occurrenceDate);
    return res.json({ occurrenceDate, status: sessionStatus(updated), session: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/opportunities/:id/session/resume', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const { error, code, opp } = requireHost(req.params.id, req);
    if (error) return res.status(code).json({ error });
    const occurrenceDate = activeOccurrenceDate(opp);
    const session = getSession(opp.id, occurrenceDate);
    if (sessionStatus(session) !== 'paused') return res.status(400).json({ error: 'This event is not paused' });
    const open = session.pauses.find((p: any) => !p.resumedAt);
    db.prepare('UPDATE session_pauses SET resumedAt = ? WHERE id = ?').run(new Date().toISOString(), open.id);
    const updated = getSession(opp.id, occurrenceDate);
    return res.json({ occurrenceDate, status: sessionStatus(updated), session: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** Stop closes every still-open segment at this instant and writes the
 * final hours. Nobody is penalised for not scanning out — the organizer
 * ending the event is what ends everyone's clock. */
router.post('/api/opportunities/:id/session/stop', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const { error, code, opp } = requireHost(req.params.id, req);
    if (error) return res.status(code).json({ error });
    const occurrenceDate = activeOccurrenceDate(opp);
    const session = getSession(opp.id, occurrenceDate);
    if (!session) return res.status(400).json({ error: 'This event has not been started' });

    // Only the stop time is recorded here. Closing everyone's open segments
    // and writing the final hours is left to reconcileSession, which caps
    // them at autoStopAt — an organizer who forgets until the next morning
    // must not hand every volunteer an extra twelve hours.
    const now = new Date().toISOString();
    db.prepare('UPDATE event_sessions SET stoppedAt = ? WHERE id = ?').run(now, session.id);
    reconcileSession(opp.id, occurrenceDate, getSession(opp.id, occurrenceDate));

    const stopped = getSession(opp.id, occurrenceDate);
    const credited = (db.prepare(
      'SELECT COUNT(DISTINCT userId) as c FROM attendance_segments WHERE opportunityId = ? AND occurrenceDate = ?'
    ).get(opp.id, occurrenceDate) as any).c;

    return res.json({ occurrenceDate, status: sessionStatus(stopped), session: stopped, credited });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/opportunities/:id/attendance', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.id;
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
    if (opp.hostId !== req.userId && !req.isAdmin) {
      return res.status(403).json({ error: 'Only the host can view this roster' });
    }

    const requestedDate = typeof req.query.date === 'string' ? req.query.date : null;
    const occurrenceDate = requestedDate || activeOccurrenceDate(opp);
    // Finalizes hours if the session ended without anyone pressing Stop.
    reconcileSession(oppId, occurrenceDate, getSession(oppId, occurrenceDate));
    const session = getSession(oppId, occurrenceDate);
    const { roster } = getMergedRoster(oppId, occurrenceDate, session, opp.duration);

    // Within-org reliability: of this volunteer's past COMMITTED events with
    // THIS host, how many ran a session to completion that they never
    // scanned into? Scoped to one org — a rough stretch at one place
    // shouldn't follow anyone across the whole platform. A past event where
    // the org never ran a session doesn't count either way — nothing to be
    // reliable or unreliable about if check-in was never open.
    const reliability: Record<string, { noShows: number; total: number }> = {};
    for (const r of roster) {
      const pastWithHost = db.prepare(
        `SELECT o.id, o.date, o.isRecurring, o.recurringDay FROM signups s JOIN opportunities o ON o.id = s.opportunityId
         WHERE s.userId = ? AND o.hostId = ? AND s.committedAt IS NOT NULL`
      ).all(r.userId, opp.hostId) as any[];
      let noShows = 0, total = 0;
      for (const p of pastWithHost) {
        const occDate = p.id === oppId ? occurrenceDate : currentOccurrenceDate(p);
        const pSession = getSession(p.id, occDate);
        if (sessionStatus(pSession) !== 'stopped') continue; // never ran, or still running — not countable
        total++;
        // Must be 'credited' specifically. A 'requested' row is the
        // volunteer's own unapproved claim — letting it count here would
        // let anyone clear their own no-show record by asserting it.
        const attended = db.prepare(
          `SELECT 1 FROM attendance WHERE opportunityId = ? AND userId = ? AND occurrenceDate = ? AND status = 'credited' AND checkInAt IS NOT NULL`
        ).get(p.id, r.userId, occDate);
        if (!attended) noShows++;
      }
      reliability[r.userId] = { noShows, total };
    }

    const pastDates = (db.prepare(
      `SELECT DISTINCT occurrenceDate FROM event_sessions WHERE opportunityId = ? ORDER BY occurrenceDate DESC`
    ).all(oppId) as any[]).map(d => d.occurrenceDate);
    const availableDates = Array.from(new Set([activeOccurrenceDate(opp), ...pastDates]));

    return res.json({
      occurrenceDate, roster, reliability, availableDates,
      // checkinPin is included here and only here — this endpoint is
      // host-only, and the organizer's screen is the one place the code is
      // meant to appear.
      session: session ? { status: sessionStatus(session), autoStartAt: session.autoStartAt, startedAt: session.startedAt, autoStopAt: session.autoStopAt, stoppedAt: session.stoppedAt, checkinPin: session.checkinPin, pauses: session.pauses } : null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/api/attendance/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const row = db.prepare(
      `SELECT a.*, o.hostId, o.title FROM attendance a JOIN opportunities o ON o.id = a.opportunityId WHERE a.id = ?`
    ).get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'Attendance record not found' });
    if (row.hostId !== req.userId && !req.isAdmin) {
      return res.status(403).json({ error: 'Only the host can adjust this record' });
    }

    const { status, hoursVerified, note } = req.body || {};
    if (!VALID_ATTENDANCE_DECISIONS.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_ATTENDANCE_DECISIONS.join(', ')}` });
    }
    if (hoursVerified !== undefined && (typeof hoursVerified !== 'number' || hoursVerified < 0)) {
      return res.status(400).json({ error: 'hoursVerified must be a non-negative number' });
    }

    // This is an adjustment, not a first approval — hours already landed at
    // checkout. Defaults to leaving the number alone; the host only needs to
    // touch it when it's actually wrong (scenario: correcting an
    // auto-closed guess, or revoking a credit entirely).
    const finalHours = status === 'rejected' ? 0 : (hoursVerified ?? row.hoursVerified ?? row.hoursClaimed ?? 0);
    const now = new Date().toISOString();
    // This is the deliberate override, so it locks: later scan activity
    // recalculates the raw segments but leaves this figure alone.
    db.prepare(
      `UPDATE attendance SET status = ?, hoursVerified = ?, note = ?, verifiedBy = ?, verifiedAt = ?, hoursLocked = 1 WHERE id = ?`
    ).run(status, finalHours, note || null, req.userId, now, row.id);

    const volunteer = db.prepare('SELECT notifyOnInterest FROM users WHERE id = ?').get(row.userId) as any;
    if (volunteer?.notifyOnInterest) {
      const message = status === 'credited'
        ? `Your hours for "${row.title}" were adjusted to ${finalHours}`
        : `Your credited hours for "${row.title}" were revoked${note ? `: ${note}` : ''}`;
      db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
        randomUUID(), row.userId, status === 'credited' ? 'hours_adjusted' : 'hours_rejected', message, row.opportunityId, now
      );
    }

    if (status === 'credited') notifyMilestones(row.userId, row.hostId);
    const updated = db.prepare('SELECT * FROM attendance WHERE id = ?').get(row.id);
    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// The kiosk substitute: a dead phone or an unscannable poster shouldn't mean
// lost hours. The org's own device stands in for the door, entering someone
// who was actually there but never scanned.
router.post('/api/opportunities/:id/attendance/mark-present', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.id;
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
    if (opp.hostId !== req.userId && !req.isAdmin) {
      return res.status(403).json({ error: 'Only the host can mark attendance' });
    }

    const { userId, hours, occurrenceDate: reqDate } = req.body || {};
    if (typeof userId !== 'string' || !userId) return res.status(400).json({ error: 'userId is required' });
    const finalHours = typeof hours === 'number' && hours >= 0 ? hours : opp.duration;
    const occurrenceDate = typeof reqDate === 'string' && reqDate ? reqDate : activeOccurrenceDate(opp);

    // Marking someone present puts them on the roster, so it commits them
    // too — otherwise a host hand-entering a walk-in would credit hours to
    // someone who then doesn't show up on their own committed list.
    const now = new Date().toISOString();
    const signup = db.prepare('SELECT * FROM signups WHERE opportunityId = ? AND userId = ?').get(oppId, userId) as any;
    if (!signup) db.prepare('INSERT INTO signups (opportunityId, userId, committedAt, createdAt) VALUES (?, ?, ?, ?)').run(oppId, userId, now, now);
    else if (!signup.committedAt) db.prepare('UPDATE signups SET committedAt = ? WHERE id = ?').run(now, signup.id);

    const existing = db.prepare('SELECT id FROM attendance WHERE opportunityId = ? AND userId = ? AND occurrenceDate = ?').get(oppId, userId, occurrenceDate) as any;
    if (existing) {
      db.prepare(`UPDATE attendance SET checkInAt = ?, checkOutAt = ?, hoursClaimed = ?, hoursVerified = ?, status = 'credited', verifiedBy = ?, verifiedAt = ? WHERE id = ?`)
        .run(now, now, finalHours, finalHours, req.userId, now, existing.id);
    } else {
      db.prepare(
        `INSERT INTO attendance (id, opportunityId, userId, occurrenceDate, checkInAt, checkOutAt, hoursClaimed, hoursVerified, status, verifiedBy, verifiedAt, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'credited', ?, ?, ?)`
      ).run(randomUUID(), oppId, userId, occurrenceDate, now, now, finalHours, finalHours, req.userId, now, now);
    }
    notifyMilestones(userId, opp.hostId);
    const row = db.prepare('SELECT * FROM attendance WHERE opportunityId = ? AND userId = ? AND occurrenceDate = ?').get(oppId, userId, occurrenceDate);
    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/opportunities/:id/attendance/export', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.id;
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
    if (opp.hostId !== req.userId && !req.isAdmin) {
      return res.status(403).json({ error: 'Only the host can export this roster' });
    }

    const requestedDate = typeof req.query.date === 'string' ? req.query.date : null;
    const occurrenceDate = requestedDate || activeOccurrenceDate(opp);
    // Finalizes hours if the session ended without anyone pressing Stop.
    reconcileSession(oppId, occurrenceDate, getSession(oppId, occurrenceDate));
    const session = getSession(oppId, occurrenceDate);
    const { roster } = getMergedRoster(oppId, occurrenceDate, session, opp.duration);

    // This lands in a spreadsheet a coordinator reads, so the columns carry
    // plain words and local clock times rather than the internal status
    // slugs and UTC stamps the API speaks in.
    const CSV_STATUS: Record<string, string> = {
      coming: 'Did not check in', here: 'Attended', left: 'Attended',
      no_show: 'Did not attend', rejected: 'Hours removed',
      requested: 'Awaiting your confirmation',
    };
    const clock = (iso: string | null) => iso
      ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '';
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'Name,Email,Date,Checked In,Checked Out,Hours,Status';
    const body = roster.map(r => [
      r.username, r.email, occurrenceDate,
      clock(r.checkInAt), clock(r.checkOutAt),
      r.hoursVerified ?? r.hoursClaimed ?? 0,
      CSV_STATUS[r.status] ?? r.status,
    ].map(esc).join(',')).join('\n');
    const csv = header + '\n' + body;

    const filename = `${opp.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${occurrenceDate}_attendance.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** A volunteer's own verified hours. Every other attendance endpoint is
 * host-facing ("who came to my event"); this is the other direction. Only
 * 'credited' rows count, so the number on a profile is always one an
 * organization signed off on — never self-reported. */
/** "I was there" — the volunteer's own claim after missing a scan.
 *
 * Dead phones, no signal, an organizer who never showed the code: the miss
 * is usually nobody's fault, and the only previous remedy was knowing which
 * human to email. This files a request the organization sees on its roster.
 * It grants nothing by itself — hours stay at 0 and the row is excluded
 * from every credited total until a host approves it. */
router.post('/api/opportunities/:id/request-hours', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.id;
    const userId = req.userId!;
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    const occurrenceDate = activeOccurrenceDate(opp);
    const session = getSession(oppId, occurrenceDate);
    if (sessionStatus(session) !== 'stopped') {
      return res.status(400).json({ error: "This event hasn't finished yet — you can still check in." });
    }
    const committed = db.prepare(
      'SELECT 1 FROM signups WHERE opportunityId = ? AND userId = ? AND committedAt IS NOT NULL'
    ).get(oppId, userId);
    if (!committed) return res.status(403).json({ error: 'Only committed volunteers can request hours.' });

    const existing = db.prepare(
      'SELECT * FROM attendance WHERE opportunityId = ? AND userId = ? AND occurrenceDate = ?'
    ).get(oppId, userId, occurrenceDate) as any;
    if (existing) {
      if (existing.status === 'requested') return res.json({ requested: true });
      return res.status(400).json({ error: 'This event already has a decision on your hours.' });
    }

    const note = typeof (req.body || {}).note === 'string' ? String(req.body.note).slice(0, 300) : null;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO attendance (id, opportunityId, userId, occurrenceDate, checkInAt, hoursClaimed, hoursVerified, status, note, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'requested', ?, ?)`
    ).run(randomUUID(), oppId, userId, occurrenceDate, now, opp.duration, note, now);

    const host = db.prepare('SELECT id, notifyOnInterest FROM users WHERE id = ?').get(opp.hostId) as any;
    if (host?.notifyOnInterest) {
      const volunteer = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
      db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
        randomUUID(), opp.hostId, 'hours_requested',
        `${volunteer?.username || 'Someone'} says they attended "${opp.title}" — review their hours`, oppId, now
      );
    }
    return res.json({ requested: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== VOLUNTEER RECORD =====
// Standard everywhere, awarded automatically. Fixed tiers are the whole
// point: a "50 Hours" certificate is only worth showing a school if it
// means the same thing at every organization, and if no organization can
// hand one out for an afternoon.
const MILESTONE_TIERS = [10, 25, 50, 100] as const;

/** A volunteer's verified record: what they did, who with, and when.
 *
 * Only 'credited' rows count, so nothing here is self-asserted — the same
 * rule the hours total already follows. Milestones are computed on read
 * rather than stored, because they're a pure function of hours per
 * organization and there's nothing to keep in sync. */
function buildRecord(userId: string) {
  const rows = db.prepare(
    `SELECT o.hostId, o.hostName, o.title, o.category, o.location,
            a.occurrenceDate, a.hoursVerified
     FROM attendance a
     JOIN opportunities o ON o.id = a.opportunityId
     WHERE a.userId = ? AND a.status = 'credited' AND a.hoursVerified > 0
     ORDER BY a.occurrenceDate DESC`
  ).all(userId) as any[];

  const byOrg = new Map<string, { hostId: string; hostName: string; hours: number; events: number }>();
  for (const r of rows) {
    const cur = byOrg.get(r.hostId) || { hostId: r.hostId, hostName: r.hostName, hours: 0, events: 0 };
    cur.hours += r.hoursVerified;
    cur.events += 1;
    byOrg.set(r.hostId, cur);
  }

  const orgs = [...byOrg.values()]
    .map(o => ({
      ...o,
      hours: Math.round(o.hours * 100) / 100,
      milestones: MILESTONE_TIERS.filter(t => o.hours >= t),
    }))
    .sort((a, b) => b.hours - a.hours);

  return {
    totalHours: Math.round(rows.reduce((s, r) => s + r.hoursVerified, 0) * 100) / 100,
    totalEvents: rows.length,
    orgs,
    events: rows.map(r => ({
      title: r.title, hostName: r.hostName, hostId: r.hostId,
      category: r.category, location: r.location,
      date: r.occurrenceDate, hours: r.hoursVerified,
    })),
  };
}

/** Verified hours this volunteer has with one organization. The single
 * source of truth for whether a certificate is deserved — recomputed from
 * credited attendance every time rather than read from anything the client
 * sent, so an application can't claim a tier that wasn't earned. */
function hoursWithOrg(userId: string, hostId: string): number {
  const row = db.prepare(
    `SELECT COALESCE(SUM(a.hoursVerified), 0) as total
     FROM attendance a JOIN opportunities o ON o.id = a.opportunityId
     WHERE a.userId = ? AND o.hostId = ? AND a.status = 'credited'`
  ).get(userId, hostId) as any;
  return row.total as number;
}

/** A certificate is only live while the hours behind it still stand. Rather
 * than storing that, it's checked whenever one is read: an organization
 * revoking hours after issue silently retires the certificate instead of
 * leaving a claim the record itself contradicts. */
function certificateIsLive(app: { userId: string; hostId: string; tier: number; status: string }): boolean {
  if (app.status !== 'issued') return false;
  return hoursWithOrg(app.userId, app.hostId) >= app.tier;
}

function certificatesFor(userId: string) {
  const rows = db.prepare(
    'SELECT id, userId, hostId, tier, status, note, decidedAt FROM certificate_applications WHERE userId = ?'
  ).all(userId) as any[];
  return rows.map(r => ({
    ...r,
    // 'revoked' is derived, never written — restoring the hours brings the
    // certificate back rather than needing anyone to re-issue it.
    status: r.status === 'issued' && !certificateIsLive(r) ? 'revoked' : r.status,
  }));
}

/** Notify a volunteer the moment credited hours push them past a tier.
 *
 * The notification id is derived from user + organization + tier, so INSERT
 * OR IGNORE makes this safe to call after every credit — the same milestone
 * can never announce itself twice, and no extra table is needed to remember
 * that it fired. */
function notifyMilestones(userId: string, hostId: string) {
  try {
    const hours = hoursWithOrg(userId, hostId);
    const reached = MILESTONE_TIERS.filter(t => hours >= t);
    if (!reached.length) return;
    const org = db.prepare('SELECT username FROM users WHERE id = ?').get(hostId) as any;
    const now = new Date().toISOString();
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)'
    );
    for (const tier of reached) {
      stmt.run(
        `ms-${userId}-${hostId}-${tier}`, userId, 'milestone_reached',
        `You've reached ${tier} verified hours with ${org?.username ?? 'an organization'} — you can apply for a certificate`,
        now
      );
    }
  } catch { /* a missed notification must never fail the credit that caused it */ }
}

router.get('/api/me/record', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    reconcileUserSegments(req.userId!);
    const user = db.prepare('SELECT profileShareToken FROM users WHERE id = ?').get(req.userId!) as any;
    const record = buildRecord(req.userId!);
    const apps = certificatesFor(req.userId!);
    // Attach per-organization application state so the profile can show
    // "apply" / "pending" / "issued" without a second request.
    const orgs: any[] = record.orgs.map(o => ({
      ...o,
      certificates: apps
        .filter(a => a.hostId === o.hostId)
        .map(a => ({ id: a.id, tier: a.tier, status: a.status, note: a.note })),
    }));

    // An organization only appears above if it currently has credited hours.
    // If every hour there was revoked, the organization — and any
    // certificate attached to it — would silently disappear from the
    // volunteer's profile, which is the one place they'd look to find out
    // why. Keep those rows, showing zero hours and the retired certificate.
    const shownHosts = new Set(orgs.map(o => o.hostId));
    for (const a of apps) {
      if (shownHosts.has(a.hostId)) continue;
      const org = db.prepare('SELECT username FROM users WHERE id = ?').get(a.hostId) as any;
      orgs.push({
        hostId: a.hostId,
        hostName: org?.username ?? 'Unknown organization',
        hours: 0,
        events: 0,
        milestones: [],
        certificates: apps
          .filter(x => x.hostId === a.hostId)
          .map(x => ({ id: x.id, tier: x.tier, status: x.status, note: x.note })),
      });
      shownHosts.add(a.hostId);
    }

    return res.json({ ...record, orgs, shareToken: user?.profileShareToken ?? null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** Apply for a milestone certificate.
 *
 * Eligibility is recomputed here from credited attendance — the request
 * body only names which organization and tier, never how many hours. A
 * client claiming 100 hours it doesn't have gets refused by the same query
 * that drew the badge. */
router.post('/api/certificates/apply', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const { hostId, tier } = req.body || {};
    if (typeof hostId !== 'string' || !hostId) return res.status(400).json({ error: 'hostId is required' });
    if (!MILESTONE_TIERS.includes(tier)) {
      return res.status(400).json({ error: `tier must be one of: ${MILESTONE_TIERS.join(', ')}` });
    }
    const org = db.prepare('SELECT id, username FROM users WHERE id = ?').get(hostId) as any;
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const hours = hoursWithOrg(req.userId!, hostId);
    if (hours < tier) {
      return res.status(403).json({ error: `You have ${Math.round(hours * 10) / 10} verified hours with ${org.username} — ${tier} are needed.` });
    }

    const existing = db.prepare(
      'SELECT id, status FROM certificate_applications WHERE userId = ? AND hostId = ? AND tier = ?'
    ).get(req.userId!, hostId, tier) as any;
    if (existing) {
      if (existing.status === 'issued') {
        return res.status(409).json({ error: 'This certificate has already been issued.' });
      }
      if (existing.status === 'declined') {
        // A decline is usually "not yet" — confirm with the organizer, sort
        // out a disputed session. Blocking forever would strand anyone who
        // then did exactly what was asked, so the old row is cleared and
        // they may apply again.
        db.prepare('DELETE FROM certificate_applications WHERE id = ?').run(existing.id);
      } else {
        return res.status(409).json({ error: 'This application is already waiting on review.' });
      }
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    // Goes to the ORGANIZATION first — the certificate carries their name,
    // so they confirm before it reaches an admin to be issued.
    db.prepare(
      `INSERT INTO certificate_applications (id, userId, hostId, tier, hoursAtApply, status, createdAt)
       VALUES (?, ?, ?, ?, ?, 'pending_org', ?)`
    ).run(id, req.userId!, hostId, tier, Math.round(hours * 100) / 100, now);

    const host = db.prepare('SELECT id, notifyOnInterest FROM users WHERE id = ?').get(hostId) as any;
    if (host?.notifyOnInterest) {
      const volunteer = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId!) as any;
      db.prepare('INSERT INTO notifications (id, userId, type, message, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)').run(
        randomUUID(), hostId, 'certificate_requested',
        `${volunteer?.username || 'A volunteer'} is requesting a ${tier}-hour certificate with your organization`, now
      );
    }
    return res.json({ id, tier, status: 'pending_org' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** The issued certificate itself. Readable without an account so it can be
 * attached to an application, but it carries only what a certificate needs
 * — name, organization, tier, date — and nothing else about the person. */
router.get('/api/certificates/:id', (req: Request, res: Response) => {
  try {
    const row = db.prepare(
      `SELECT c.id, c.userId, c.hostId, c.tier, c.status, c.decidedAt, c.hoursAtApply,
              v.username as volunteerName, o.username as orgName
       FROM certificate_applications c
       JOIN users v ON v.id = c.userId
       JOIN users o ON o.id = c.hostId
       WHERE c.id = ?`
    ).get(req.params.id) as any;
    if (!row || row.status !== 'issued') {
      return res.status(404).json({ error: 'No issued certificate here' });
    }
    // Re-checked on every read: if the organization has since revoked hours
    // that took this volunteer below the tier, the certificate no longer
    // stands. 410 rather than 404 so the page can say what happened instead
    // of pretending the link was never real.
    if (!certificateIsLive(row)) {
      return res.status(410).json({
        error: 'This certificate is no longer valid — the hours behind it were adjusted by the organization.',
      });
    }
    // userId/hostId were selected only for the liveness check above — this
    // response is public, so it carries names and nothing identifying.
    const { userId, hostId, ...publicCert } = row;
    return res.json(publicCert);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** Mint (or reuse) the share link. Deliberately an explicit action — the
 * profile is private until the person decides otherwise. */
router.post('/api/me/share', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const user = db.prepare('SELECT profileShareToken FROM users WHERE id = ?').get(req.userId!) as any;
    if (user?.profileShareToken) return res.json({ shareToken: user.profileShareToken });
    const token = randomUUID();
    db.prepare('UPDATE users SET profileShareToken = ? WHERE id = ?').run(token, req.userId!);
    return res.json({ shareToken: token });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** Revoking clears the token outright, so every copy of the old link stops
 * working rather than quietly staying live somewhere. */
router.delete('/api/me/share', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    db.prepare('UPDATE users SET profileShareToken = NULL WHERE id = ?').run(req.userId!);
    return res.json({ shareToken: null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** The link a counselor opens. Unauthenticated by design, so a school
 * doesn't need an account — but it exposes only what a volunteer record
 * needs: display name, hours, organizations, events. No email, no user id,
 * no upcoming events, so it can't be used to work out where someone will
 * be. Unguessable and revocable. */
router.get('/api/profile/shared/:token', (req: Request, res: Response) => {
  try {
    const user = db.prepare(
      'SELECT id, username, createdAt FROM users WHERE profileShareToken = ?'
    ).get(req.params.token) as any;
    if (!user) return res.status(404).json({ error: 'This link is no longer active' });
    reconcileUserSegments(user.id);
    const record = buildRecord(user.id);
    return res.json({
      username: user.username,
      memberSince: user.createdAt,
      totalHours: record.totalHours,
      totalEvents: record.totalEvents,
      orgs: record.orgs.map(o => ({ hostName: o.hostName, hours: o.hours, events: o.events, milestones: o.milestones })),
      events: record.events.map(e => ({ title: e.title, hostName: e.hostName, date: e.date, hours: e.hours })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/api/me/hours', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    // A volunteer who scanned in and never scanned out has no finalized
    // hours until something closes them out. This is their own page, so it
    // has to do that itself rather than wait for an organizer to open a
    // roster — otherwise attending an event reads as zero hours.
    reconcileUserSegments(req.userId!);
    const row = db.prepare(
      `SELECT COALESCE(SUM(hoursVerified), 0) as total
       FROM attendance WHERE userId = ? AND status = 'credited'`
    ).get(req.userId!) as any;
    return res.json({ total: row.total });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
