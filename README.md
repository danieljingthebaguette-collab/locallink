# LocalLink

A community volunteer platform — discover local opportunities, connect with organizations, and track your impact.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion |
| State | Zustand |
| Routing | Wouter v3 |
| UI components | shadcn/ui (Radix UI) |
| Backend | Express 5, TypeScript (tsx) |
| Database | SQLite via better-sqlite3 |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Email | Nodemailer (Gmail SMTP) |

---

## Prerequisites

- **Node.js 18 or later** — [nodejs.org](https://nodejs.org)
- **npm** (comes with Node)
- A **Gmail account** with an App Password if you want email verification/password-reset to work (optional for local dev)

---

## Quick Start (Local Development)

### 1. Clone or unzip the project

```bash
git clone <repo-url>
cd locallink
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in at minimum:

```env
JWT_SECRET=any-long-random-string
ADMIN_EMAIL=the-email-you-will-register-with-for-admin-access
```

Email fields are optional — if left blank the server starts fine but verification emails won't send. In that case, manually set `emailVerified = 1` in the DB for any test accounts (see tip below).

### 4. Run in development mode

Run **both** the API server and the Vite dev server in a single command:

```bash
npm run dev:full
```

Or run them in separate terminals for cleaner logs:

```bash
# Terminal 1 — API server (port 3001, hot-reload)
npm run dev:server

# Terminal 2 — Vite dev server (port 5173, HMR)
npm run dev
```

Open **http://localhost:5173** in your browser.

### 5. Create your admin account

1. Register at `/account` using the email you set as `ADMIN_EMAIL` in `.env`
2. The server auto-grants admin rights and auto-verifies that email on startup
3. Log in — you'll land on the home feed. Navigate to `/admin` to access the admin panel

> **No email config?** After registering, run this once to verify your account manually:
> ```bash
> npx tsx -e "
> import Database from 'better-sqlite3';
> const db = new Database('./locallink.db');
> db.prepare('UPDATE users SET emailVerified = 1 WHERE email = ?').run('your@email.com');
> console.log('Verified');
> "
> ```

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Vite frontend dev server on port 5173 |
| `npm run dev:server` | Start Express API with hot-reload on port 3001 |
| `npm run dev:full` | Start both servers concurrently |
| `npm run build` | Build frontend to `dist/` |
| `npm start` | Run the production Express server (serves built frontend + API) |

---

## Project Structure

```
locallink/
├── client/                  # React frontend
│   ├── index.html
│   └── src/
│       ├── App.tsx           # Routes (wouter)
│       ├── main.tsx
│       ├── index.css         # Tailwind base styles
│       ├── components/
│       │   ├── Navigation.tsx
│       │   ├── Logo.tsx
│       │   ├── CreatePostModal.tsx
│       │   └── ui/           # shadcn/ui components
│       ├── hooks/
│       │   └── use-toast.ts
│       ├── lib/
│       │   ├── store.ts       # Zustand stores (auth, opportunities, admin, favorites)
│       │   ├── mockData.ts    # TypeScript interfaces + category/tag definitions
│       │   ├── cardUtils.ts   # Bento grid sizing helpers
│       │   ├── categoryUtils.ts
│       │   └── utils.ts
│       └── pages/
│           ├── home.tsx       # Main feed with bento card grid
│           ├── account.tsx    # Login / register
│           ├── profile.tsx    # User profile + stats
│           ├── my-events.tsx  # Events I'm interested in / hosting
│           ├── admin.tsx      # Admin panel
│           ├── leaderboard.tsx
│           ├── about.tsx
│           └── ...
│
├── server/
│   ├── index.ts              # Express app entry point
│   ├── routes.ts             # All API routes
│   ├── db.ts                 # SQLite setup, migrations, seed data
│   └── email.ts              # Nodemailer email helpers
│
├── locallink.db              # SQLite database (auto-created on first run, gitignored)
├── uploads/                  # Uploaded images (gitignored)
├── .env                      # Your local config (gitignored — copy from .env.example)
├── .env.example              # Template — commit this, not .env
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## API Overview

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Register new account |
| POST | `/api/auth/login` | — | Login, returns JWT |
| GET | `/api/auth/verify-email` | — | Verify email from link |
| POST | `/api/auth/resend-verification` | — | Resend verification email |
| POST | `/api/auth/forgot-password` | — | Send password reset email |
| POST | `/api/auth/reset-password` | — | Reset password via token |
| PUT | `/api/auth/profile` | ✓ | Update username / password |
| GET | `/api/opportunities` | — | List all opportunities |
| POST | `/api/opportunities` | ✓ org/admin | Create opportunity |
| PUT | `/api/opportunities/:id` | ✓ host/admin | Edit opportunity |
| DELETE | `/api/opportunities/:id` | ✓ host/admin | Delete opportunity |
| POST | `/api/opportunities/:id/signup` | ✓ | Express interest |
| DELETE | `/api/opportunities/:id/signup` | ✓ | Remove interest |
| GET | `/api/favorites` | ✓ | List favorited orgs |
| POST | `/api/favorites/:orgId` | ✓ | Add favorite |
| DELETE | `/api/favorites/:orgId` | ✓ | Remove favorite |
| GET | `/api/admin/users` | ✓ admin | List all users |
| DELETE | `/api/admin/users/:id` | ✓ admin | Delete user |
| PUT | `/api/admin/opportunities/:id` | ✓ admin | Admin edit opportunity |
| DELETE | `/api/admin/opportunities/:id` | ✓ admin | Admin delete opportunity |
| GET | `/api/admin/stats` | ✓ admin | Site-wide stats |
| POST | `/api/upload` | ✓ | Upload image (max 5 MB) |
| GET | `/api/health` | — | Health check |

---

## Key Features

- **Bento grid feed** — cards sized by popularity, packed with CSS `grid-flow-dense`
- **Sort & filter** — by Newest / Oldest / Soonest / Popular, plus category pills
- **Account types** — `volunteer` vs `organization`; only orgs can post opportunities
- **Favorites** — heart any org, see them on your profile
- **Admin panel** — manage users and edit/delete any post
- **Email verification** — required before login (Gmail SMTP)
- **Password reset** — via email link

---

## Production Deployment

### Build the frontend

```bash
npm run build
# Outputs to dist/
```

### Run the server

```bash
npm start
# Express serves the built frontend + API on PORT (default 3001)
```

Set these environment variables on your host:

```env
NODE_ENV=production
JWT_SECRET=<long random string>
PORT=3001
CLIENT_URL=https://your-domain.com
APP_URL=https://your-domain.com
ADMIN_EMAIL=your@email.com
DB_PATH=/data/locallink.db   # persistent volume path
EMAIL_USER=...
EMAIL_PASS=...
```

### Recommended hosts

| Host | Notes |
|---|---|
| **Railway** | Attach a Volume, set `DB_PATH=/data/locallink.db` |
| **Fly.io** | Use a persistent volume, set `DB_PATH=/data/locallink.db` |
| **Render** | Use a Disk, set DB_PATH accordingly |

> The SQLite DB and `uploads/` directory must be on a persistent disk in production, otherwise data resets on every deploy.

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | Yes | `locallink-dev-secret-…` | Signs auth tokens. Change in production. |
| `PORT` | No | `3001` | API server port |
| `CLIENT_URL` | No | `http://localhost:5173` | Allowed CORS origin |
| `APP_URL` | No | `http://localhost:5173` | Used in email links |
| `ADMIN_EMAIL` | Yes | `linklocal2@gmail.com` | Auto-granted admin on first login |
| `DB_PATH` | No | `./locallink.db` | Absolute path to SQLite file |
| `EMAIL_HOST` | No | — | SMTP host (e.g. `smtp.gmail.com`) |
| `EMAIL_PORT` | No | — | SMTP port (587 for Gmail) |
| `EMAIL_SECURE` | No | — | `true` for port 465 |
| `EMAIL_USER` | No | — | Gmail address |
| `EMAIL_PASS` | No | — | Gmail App Password (16 chars) |
| `EMAIL_FROM` | No | — | Display name + address for outgoing mail |
