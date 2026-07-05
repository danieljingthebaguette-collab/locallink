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
app.use(helmet());

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

// Apply rate limiting to auth endpoints
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

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
app.use('/uploads', express.static(uploadsPath));

// Serve frontend in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// ── OG preview tags for social crawlers ──────────────────────────────────────
// Browsers hit /?post=ID and get the SPA which opens the modal client-side.
// Crawlers (Twitterbot, Slack, Discord, WhatsApp, etc.) never run JS — they
// need real og: meta tags in the HTML they receive.  For those UAs only, look
// up the post from DB and return a minimal HTML response so link-unfurls work.
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

app.get('/{*path}', (_req, res) => {
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
