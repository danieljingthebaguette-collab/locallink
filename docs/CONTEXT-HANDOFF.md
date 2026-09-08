# LocalLink — full context handoff

You are helping me work on **LocalLink**. Read all of this before answering.
Everything below is verified against the actual codebase as of 7 September 2026.

---

## 1. What LocalLink is

A volunteer opportunity board for **Somerset County, New Jersey**. Local
organizations post volunteering opportunities; local people (mostly high school
students who need service hours) browse them and tap "I'm Interested". The
organization gets notified and the two coordinate directly. LocalLink itself
does not manage the volunteering — it is the introduction layer.

Live at **localnetlink.com**. Small, real, and already has real users — this is
not a toy project or a prototype.

Two kinds of account: **volunteer** and **organization**. Plus one admin.

---

## 2. Tech stack (exact)

**Front end**
- React 19.2 + TypeScript 5.6, built with Vite 7.1
- Tailwind CSS v4 (note: v4, not v3 — no `tailwind.config.js` theme block,
  config is CSS-first via `@theme`)
- wouter 3.3 for routing (NOT react-router)
- Zustand 5 for state, @tanstack/react-query for server state
- Framer Motion 12 for animation
- Radix UI primitives + lucide-react icons

**Back end**
- Express 5.2 (note: v5, error-handling and routing differ from v4)
- better-sqlite3 12.6 — **synchronous** SQLite, no async/await on queries
- JWT auth (jsonwebtoken), bcryptjs for passwords
- express-rate-limit
- **Brevo** transactional email API (via plain fetch, no SDK)

**Deployment**
- Railway, auto-deploying from GitHub `danieljingthebaguette-collab/locallink`
- SQLite file on a Railway volume. **There are no backups.** This is a known,
  unaddressed risk.

---

## 3. Layout

```
server/           ~4,200 lines total
  routes.ts       the entire API (largest file by far)
  db.ts           schema + idempotent migrations, runs at import
  email.ts        all email templates
  scheduler.ts    hourly cron-ish job for weekly reopen reminders
  index.ts        express setup, static files, upload handling, CSP
  time.ts         date helpers

client/src/       45 .ts/.tsx files
  pages/          18 pages: home, about, account, profile, org-profile,
                  my-events, admin, join, privacy, terms, not-found,
                  verify-email, forgot-password, reset-password,
                  hours, certificate, check-certificate, approve-hours
  components/     Navigation, OnboardingQuestionnaire, CreatePostModal,
                  Linkified, etc.
  lib/            store.ts (Zustand), categoryUtils.ts, utils.ts
```

**Database tables (17):** users, opportunities, signups, favorites,
notifications, feedback, reports, appeals, email_verifications,
password_resets, onboarding_links, push_subscriptions,
hour_logs, confirmed_orgs, certificates, certificate_entries, sqlite_sequence

---

## 4. Conventions that matter

- **Migrations are idempotent and run at import time** in `db.ts`, using the
  pattern `try { SELECT col } catch { ALTER TABLE ADD COLUMN }`. **Order
  matters** — a data repair must run *after* the migration that creates its
  column. Anything that throws at import stops the server booting, so risky
  backfills are wrapped in try/catch.
- **The users table has no `name` column.** It is `username`.
- Tailwind v4's preflight gives `<button>` `cursor: default` — buttons need an
  explicit `cursor-pointer`.
- Tailwind JIT only sees literal class strings; dynamically built class names
  silently produce no CSS.
- Post tags carry a leading emoji (e.g. `🌱 Environment`). Anything comparing
  tags must strip it first — see `client/src/lib/categoryUtils.ts`.
- Scheduler uses **local community time**, not UTC, for "Sunday evening".
  Do not reintroduce `getDay()`/`getHours()` on a UTC host.
- Never compute time cutoffs with SQLite `datetime('now')` — compute the ISO
  string in JS and pass it as a parameter.

---

## 5. What exists and works today (live)

- Public board with search, filters by town and field, and sort
- Post detail with "I'm Interested" — one tap, organization gets notified
- Sign up / log in / email verification / password reset
- Organization posting flow, admin approval of posts
- Admin panel: users, posts, reports, appeals, feedback, plus a per-user
  "send them the questionnaire" email button and a bulk nudge with a 7-day
  cooldown
- Volunteer onboarding questionnaire (interests, majors, towns, availability,
  hours so far, goals) which feeds a match score on the board
- In-app notification bell
- Weekly Sunday-evening email + notification for recurring opportunities
- Favorites (organizations only)
- Reporting and appeals

---

## 6. What was just built but is NOT live: the hour tracker

Two commits sit unpushed on the local branch `no-notifications`, which is
2 ahead of `origin/main`:

- `95bbaa3` — two security fixes
- `e7a6b0e` — the hour tracker

Together: 11 files, ~1,470 insertions.

### The security fixes (95bbaa3)
1. **Email harvesting.** Favoriting was open to any account and the response
   included the favorited user's email, so anyone could walk the public board
   and collect volunteer email addresses. Now organizations-only, and the
   response no longer carries emails.
2. **Executable uploads.** A `.html` or `.js` file labelled `image/png` was
   accepted and then served as `text/html` from our own domain. Now the
   extension comes from an allow-list keyed on real content type, magic bytes
   are checked, SVG is deliberately excluded, and `/uploads` is served with a
   sandboxing CSP.

### The hour tracker (e7a6b0e)

The idea: volunteering done through LocalLink turns into a record a school
will actually accept.

The flow:
```
volunteer logs hours (organization, date, hours, what they did, who can confirm)
   ↓  the entry LOCKS — they cannot edit it or change the approver afterwards
approver gets an email with three buttons: Yes · The hours were different · They didn't
   one-time link, no account needed
   ↓
hours become confirmed
   ↓
volunteer generates a certificate → gets a code like NJ3G-XGBT
   ↓
a teacher types that code at /check and sees whether it is genuine
```

The locking is the whole product. A record the volunteer can edit after
submission is a PDF anyone could fake.

**Two trust tiers, stated honestly on the certificate:**
- *Confirmed organization* — an admin has confirmed this organization is real
- *Approved by a named person* — everything else; still counts, labelled plainly

A mixed certificate says so: "4 of 6.5 hours are with organizations LocalLink
has confirmed are real."

**Added:** 4 pages (`hours`, `certificate`, `check-certificate`,
`approve-hours`), a volunteer-only "Hours" nav item, 12 API endpoints,
4 tables (`hour_logs`, `confirmed_orgs`, `certificates`, `certificate_entries`),
a `users.goalHours` column, 2 email templates, print styles.

Also: on the My Hours page, an **"Events you went to"** section lists LocalLink
events the volunteer signed up for that have passed and have no hours logged
yet. One tap prefills the form with the organization and date locked to what
the post advertised.

**Tested end to end locally** — logging, the approval email link, adjusting
hours with a note, single-use link refusing reuse, certificate generation,
public verification, and the guards (no self-approval, no future dates, 30h
cap per entry, no logging an event you didn't attend, no double-logging, no
deleting a decided entry, admin authorization).

---

## 7. Known open problems (all verified, none fixed)

**In the tracker, not yet pushed:**
1. **No admin screen for confirming organizations.** The two endpoints
   (`GET /api/admin/hour-orgs`, `POST /api/admin/hour-orgs/:key/confirm`)
   exist and work, but nothing in the client calls them. There is currently no
   way through the UI to mark an organization as real.
2. **Certificates made in the evening are dated tomorrow.** `fmt()` in
   `certificate.tsx`, `check-certificate.tsx` and `hours.tsx` does
   `iso.slice(0, 10)`, which reads the UTC date. Correct for `serviceDate`
   (stored as a bare `YYYY-MM-DD`), wrong for `issuedAt` (a full UTC
   timestamp). A future issue date on a document a school checks looks like a
   forgery.

**In the live site:**
3. **Monday recurring events never get a reminder.** Confirmed by replaying the
   clock hour by hour across three weeks. The Sunday-evening job does not
   reach an event happening the next day.
4. **The unsubscribe link is ignored by the weekly reopen email.**
   `emailReminders = 0` is the global opt-out, but `scheduler.ts` only checks
   `notifyOnReopen` — it never even selects `emailReminders`. Someone who
   unsubscribed still gets the Sunday email. It also does not check
   `emailVerified`.
5. **A user setting is silently reset on every deploy.** `db.ts` line ~295 runs
   `UPDATE users SET notifyOnInterest = 1 WHERE notifyOnInterest = 0 OR
   notifyOnInterest IS NULL` unconditionally at import. It was meant as a
   one-time backfill, but it runs at every boot, so anyone who turns that
   setting off has it turned back on at the next restart.
6. **Signup leak.** Clicking "I'm Interested" while signed out sends you to
   sign up and loses the post you were looking at.
7. **No database backups at all.**
8. **`spotsRemaining` is decorative** — displayed but not enforced.
9. **The board's API response publishes the user IDs of everyone signed up.**
   Fixing it properly is a refactor touching ~17 sites, deliberately deferred.
10. No footer, no meta description, no og:image. Signed-out navigation has dead
    ends. An organization can view a volunteer's profile page.

---

## 8. There is also a separate standalone app

`locallink-hours` — a full standalone version of the tracker with its own
database, login and port, built before I decided to fold the tracker into the
main site. It is superseded and its fate is undecided. Ignore it unless I bring
it up.

---

## 9. How to work with me

- **Explain everything simply. No jargon, no advanced terminology.** If a
  technical term is unavoidable, say what it means in plain words.
- Plan first, then experiment, then change, then execute.
- When something is ambiguous, ask me — and show me a concrete example of what
  you mean when you do.
- Don't tell me something works unless you actually checked. If you couldn't
  check it, say so.
- If you find a bug while doing something else, tell me about it.
- Short and direct beats long and hedged.

---

## 10. What I want from you right now

[Replace this line with your actual question.]
