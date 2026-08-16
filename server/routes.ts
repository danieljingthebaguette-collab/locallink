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
function withTags(opp: any, signups: string[] = []) {
  return { ...opp, tags: safeJsonParse<string[]>(opp.tags, []), steps: safeJsonParse<string[]>(opp.steps, []), signups, hostVerified: !!opp.hostVerified };
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
      withTags(opp, (getSignups.all(opp.id) as any[]).map(s => s.userId))
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
    const signups = (db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(opp.id) as any[]).map(s => s.userId);
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
    const signups = (db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(oppId) as any[]).map(s => s.userId);
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
    const signups = (db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(oppId) as any[]).map(s => s.userId);
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
    const signups = (db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(oppId) as any[]).map(s => s.userId);
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
    const signups = (db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(oppId) as any[]).map(s => s.userId);
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
    const signups = (db.prepare('SELECT userId FROM signups WHERE opportunityId = ?').all(oppId) as any[]).map((s: any) => s.userId);
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
  return occ.toISOString().slice(0, 10);
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

const CHECKIN_GRACE_BEFORE_MS = 30 * 60_000;   // gate opens 30 min before listed start

const VALID_ATTENDANCE_DECISIONS = ['credited', 'rejected'] as const;

/** The merged roster for one occurrence: every signup, left-joined to that
 * occurrence's attendance row if one exists. No row at all becomes Pending
 * or No-show depending on whether the session's already over — both
 * derived, neither stored. */
function getMergedRoster(oppId: string, opp: any, occurrenceDate: string) {
  const { end } = occurrenceWindow(opp, occurrenceDate);
  const eventEnded = Date.now() > end.getTime();
  const rows = db.prepare(
    `SELECT u.id as userId, u.username, u.email, s.createdAt as signedUpAt,
            a.id as attendanceId, a.checkInAt, a.checkOutAt, a.hoursClaimed, a.hoursVerified, a.status, a.note
     FROM signups s
     JOIN users u ON u.id = s.userId
     LEFT JOIN attendance a ON a.opportunityId = s.opportunityId AND a.userId = s.userId AND a.occurrenceDate = ?
     WHERE s.opportunityId = ?
     ORDER BY s.createdAt ASC`
  ).all(occurrenceDate, oppId) as any[];
  return { eventEnded, roster: rows.map(r => ({ ...r, status: r.status || (eventEnded ? 'no_show' : 'pending') })) };
}

// What the check-in page reads on load, before anyone taps anything — lets
// it show "check-in opens at 8:45" or an already-credited result immediately,
// rather than only surfacing that after a failed tap.
router.get('/api/checkin/:opportunityId/status', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.opportunityId;
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    const occurrenceDate = currentOccurrenceDate(opp);
    const { start, end } = occurrenceWindow(opp, occurrenceDate);
    const attendance = db.prepare(
      'SELECT * FROM attendance WHERE opportunityId = ? AND userId = ? AND occurrenceDate = ?'
    ).get(oppId, req.userId, occurrenceDate) || null;
    const signedUp = !!db.prepare('SELECT 1 FROM signups WHERE opportunityId = ? AND userId = ?').get(oppId, req.userId);

    return res.json({
      occurrenceDate,
      gateOpensAt: new Date(start.getTime() - CHECKIN_GRACE_BEFORE_MS).toISOString(),
      gateEndsAt: end.toISOString(),
      signedUp,
      attendance,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/api/checkin/:opportunityId', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const oppId = req.params.opportunityId;
    const userId = req.userId!;
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any;
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    const occurrenceDate = currentOccurrenceDate(opp);
    const { start, end } = occurrenceWindow(opp, occurrenceDate);
    const now = new Date();
    // The gate is what makes a photographed poster worthless outside the
    // event window — the QR/link carries no identity or secrecy of its own.
    if (now.getTime() < start.getTime() - CHECKIN_GRACE_BEFORE_MS) {
      return res.status(403).json({ error: `Check-in opens at ${start.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}.`, opensAt: start.toISOString() });
    }
    if (now.getTime() > end.getTime()) {
      return res.status(403).json({ error: 'This session has ended.' });
    }

    const existing = db.prepare(
      'SELECT * FROM attendance WHERE opportunityId = ? AND userId = ? AND occurrenceDate = ?'
    ).get(oppId, userId, occurrenceDate);
    if (existing) return res.json(existing); // idempotent — a repeat scan doesn't double-credit

    // Walk-in: scanning in place of tapping Interested first. One action
    // does both, mirroring what POST /signup does, so nobody has to work
    // out which button to press standing at the door.
    const signedUp = db.prepare('SELECT 1 FROM signups WHERE opportunityId = ? AND userId = ?').get(oppId, userId);
    if (!signedUp) {
      db.prepare('INSERT INTO signups (opportunityId, userId, createdAt) VALUES (?, ?, ?)').run(oppId, userId, now.toISOString());
      db.prepare('UPDATE opportunities SET popularity = popularity + 1 WHERE id = ?').run(oppId);
      if (opp.hostId !== userId) {
        const host = db.prepare('SELECT id, notifyOnInterest FROM users WHERE id = ?').get(opp.hostId) as any;
        if (host?.notifyOnInterest) {
          const volunteer = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
          db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
            randomUUID(), opp.hostId, 'interest', `${volunteer?.username || 'Someone'} is interested in "${opp.title}"`, oppId, now.toISOString()
          );
        }
      }
    }

    // The scan credits the event's full listed duration right away.
    const id = randomUUID();
    db.prepare(
      `INSERT INTO attendance (id, opportunityId, userId, occurrenceDate, checkInAt, hoursClaimed, hoursVerified, status, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'credited', ?)`
    ).run(id, oppId, userId, occurrenceDate, now.toISOString(), opp.duration, opp.duration, now.toISOString());

    // Bell only, no email — per-scan emails don't scale against the
    // provider's daily cap; the org gets a batched digest instead (not yet
    // built). The bell is free, so there's no reason to withhold it too.
    if (opp.hostId !== userId) {
      const host = db.prepare('SELECT id, notifyOnInterest FROM users WHERE id = ?').get(opp.hostId) as any;
      if (host?.notifyOnInterest) {
        const volunteer = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
        db.prepare('INSERT INTO notifications (id, userId, type, message, postId, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
          randomUUID(), opp.hostId, 'hours_credited', `${volunteer?.username || 'Someone'} checked in — ${opp.duration} hrs credited for "${opp.title}"`, oppId, now.toISOString()
        );
      }
    }

    const row = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
    return res.json(row);
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
    const occurrenceDate = requestedDate || currentOccurrenceDate(opp);
    const { eventEnded, roster } = getMergedRoster(oppId, opp, occurrenceDate);

    // Within-org reliability: of this volunteer's past events with THIS
    // host (any of them, not just this one) that have already happened, how
    // many did they no-show? Scoped to one org on purpose — a rough stretch
    // at one place shouldn't follow anyone across the whole platform.
    const reliability: Record<string, { noShows: number; total: number }> = {};
    for (const r of roster) {
      const pastWithHost = db.prepare(
        `SELECT o.id, o.date, o.duration, o.isRecurring, o.recurringDay, o.recurringTime
         FROM signups s JOIN opportunities o ON o.id = s.opportunityId
         WHERE s.userId = ? AND o.hostId = ?`
      ).all(r.userId, opp.hostId) as any[];
      let noShows = 0, total = 0;
      for (const p of pastWithHost) {
        const occDate = p.id === oppId ? occurrenceDate : currentOccurrenceDate(p);
        const { end: pEnd } = occurrenceWindow(p, occDate);
        if (Date.now() <= pEnd.getTime()) continue; // hasn't happened yet — not countable either way
        total++;
        const attended = db.prepare(
          `SELECT 1 FROM attendance WHERE opportunityId = ? AND userId = ? AND occurrenceDate = ? AND status = 'credited'`
        ).get(p.id, r.userId, occDate);
        if (!attended) noShows++;
      }
      reliability[r.userId] = { noShows, total };
    }

    const pastDates = (db.prepare(
      `SELECT DISTINCT occurrenceDate FROM attendance WHERE opportunityId = ? ORDER BY occurrenceDate DESC`
    ).all(oppId) as any[]).map(d => d.occurrenceDate);
    const availableDates = Array.from(new Set([currentOccurrenceDate(opp), ...pastDates]));

    return res.json({ occurrenceDate, eventEnded, roster, reliability, availableDates });
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
    db.prepare(
      `UPDATE attendance SET status = ?, hoursVerified = ?, note = ?, verifiedBy = ?, verifiedAt = ? WHERE id = ?`
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
    const occurrenceDate = typeof reqDate === 'string' && reqDate ? reqDate : currentOccurrenceDate(opp);

    const signedUp = db.prepare('SELECT 1 FROM signups WHERE opportunityId = ? AND userId = ?').get(oppId, userId);
    if (!signedUp) db.prepare('INSERT INTO signups (opportunityId, userId, createdAt) VALUES (?, ?, ?)').run(oppId, userId, new Date().toISOString());

    const now = new Date().toISOString();
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
    const occurrenceDate = requestedDate || currentOccurrenceDate(opp);
    const { roster } = getMergedRoster(oppId, opp, occurrenceDate);

    // No "Check Out" column — there's no second scan anymore, so it would
    // just be an empty column in every row.
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'Name,Email,Date,Checked In,Hours,Status';
    const body = roster.map(r => [r.username, r.email, occurrenceDate, r.checkInAt, r.hoursVerified ?? r.hoursClaimed, r.status].map(esc).join(',')).join('\n');
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
router.get('/api/me/hours', requireAuth, (req: AuthRequest, res: Response) => {
  try {
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
