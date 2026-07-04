import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import routes from './routes.js';
import { startReopenScheduler } from './scheduler.js';

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
