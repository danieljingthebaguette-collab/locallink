import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import routes from './routes.js';
import { startReopenScheduler } from './scheduler.js';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Security headers — sets X-Frame-Options, X-Content-Type-Options, HSTS, etc.
// helmet's default policy is script-src 'self', which silently blocks Google's
// sign-in script -- no error, just a button that never appears. These open
// exactly the Google endpoints the sign-in needs, using the parent /gsi/ URL
// rather than individual files, which is what Google asks for so their own
// updates cannot break us.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
      'frame-src': ["'self'", 'https://accounts.google.com/gsi/'],
      'connect-src': ["'self'", 'https://accounts.google.com/gsi/'],
      'img-src': ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com'],
    },
  },
  // Google hands the credential back from a popup it opens, and it needs
  // window.opener to do it. helmet's default of same-origin severs that:
  // the popup lands on accounts.google.com/gsi/transform, finds nothing to
  // talk to, and sits there blank forever with no error anywhere.
  // allow-popups keeps the protection that matters -- other sites still
  // cannot open us and reach in -- while letting our own popup answer.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

// Rate limiter: max 20 login/register attempts per IP per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter: max 30 report/feedback submissions per IP per 15 minutes
// Separate from authLimiter so the thresholds can be tuned independently
const reportFeedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many submissions, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.set('query parser', 'simple');

// Separate limiter for unauthenticated password-recovery routes so that
// login/register spam cannot drain the forgot-password budget and vice-versa.
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to auth endpoints
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/google', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', recoveryLimiter);
app.use('/api/auth/resend-verification', recoveryLimiter);
app.use('/api/auth/reset-password', recoveryLimiter);
// Appeals are unauthenticated by necessity (suspended users can't log in) —
// same anonymous low-volume abuse profile as password recovery.
app.use('/api/appeals', recoveryLimiter);

// Apply rate limiting to report and feedback submission endpoints
app.use('/api/reports', reportFeedbackLimiter);
app.use('/api/feedback', reportFeedbackLimiter);

// API routes
app.use(routes);

// Serve uploaded images — use the same persistent disk as the DB in production
const dbPath = process.env.DB_PATH;
const uploadsPath = dbPath
  ? path.join(path.dirname(dbPath), 'uploads')
  : path.join(__dirname, '..', 'uploads');
// Upload filenames are unique (timestamp + random) and never rewritten, so
// they're safe to cache hard. Without this they were served max-age=0 and
// every page view re-fetched every post image.
app.use('/uploads', express.static(uploadsPath, {
  maxAge: '30d',
  immutable: true,
  setHeaders(res) {
    // Belt and braces around the checks in routes.ts. Even if a file that is
    // not really an image ever reaches this folder, these headers stop the
    // browser treating it as a page on our own origin -- which is what made
    // the old upload hole an account takeover rather than a nuisance.
    // Sandboxed, no scripts, and offered as a download rather than rendered.
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
  },
}));

// ── OG preview tags for social crawlers ──────────────────────────────────────
// IMPORTANT: must be registered BEFORE express.static(distPath). The static
// middleware serves dist/index.html for all GET / requests (stripping the
// query string to resolve the path), so placing this route after it means
// crawlers would get the generic index.html instead of per-post OG tags.
//
// Browsers hit /?post=ID, get the SPA, and the SPA opens the modal client-side.
// Crawlers (Twitterbot, Slackbot, etc.) never run JS — they need real og:
// meta tags baked into the HTML they fetch. For those UAs only, query the DB
// and return a minimal HTML response so link-unfurls show the right title/image.
const CRAWLER_UA =
  /Twitterbot|facebookexternalhit|Slackbot|Discordbot|WhatsApp|LinkedInBot|TelegramBot|Googlebot/i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

app.get('/', (req: Request, res: Response, next: NextFunction) => {
  if (!CRAWLER_UA.test(req.headers['user-agent'] || '')) return next();
  const postId = req.query.post as string | undefined;
  if (!postId) return next();

  const opp = db.prepare(
    "SELECT title, description, image FROM opportunities WHERE id = ? AND status = 'approved'"
  ).get(postId) as { title: string; description: string | null; image: string | null } | undefined;
  if (!opp) return next();

  const appUrl = (process.env.APP_URL || 'https://www.localnetlink.com').replace(/\/$/, '');
  const title = escapeHtml(opp.title);
  const desc = escapeHtml(
    opp.description && opp.description.length > 0
      ? opp.description.slice(0, 200) + (opp.description.length > 200 ? '…' : '')
      : 'A volunteer opportunity on LocalLink'
  );
  const pageUrl = escapeHtml(`${appUrl}/?post=${postId}`);

  let imgTags = '';
  if (opp.image) {
    const imgUrl = escapeHtml(opp.image.startsWith('http') ? opp.image : `${appUrl}${opp.image}`);
    imgTags = `  <meta property="og:image" content="${imgUrl}" />\n  <meta name="twitter:image" content="${imgUrl}" />`;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} — LocalLink</title>
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="LocalLink" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
${imgTags}
  <meta name="twitter:card" content="${opp.image ? 'summary_large_image' : 'summary'}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
</head>
<body></body>
</html>`);
});

// Serve frontend in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath, {
  setHeaders(res, filePath) {
    // Vite fingerprints everything in assets/ (index-<hash>.js), so those are
    // immutable and can be cached for a year. index.html must NOT be — it's
    // what points at the current hashes, and a cached copy would pin visitors
    // to a stale build after every deploy.
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
app.get('/{*path}', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(distPath, 'index.html'));
});

// Global error handler — catches any unhandled error thrown by route handlers or middleware.
// Must have 4 parameters so Express recognises it as an error handler.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[unhandled error]', err);
  const status = typeof err.status === 'number' ? err.status : 500;
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || 'Internal server error');
  res.status(status).json({ error: message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LocalLink server running on http://localhost:${PORT}`);
  startReopenScheduler();
});

export default app;
