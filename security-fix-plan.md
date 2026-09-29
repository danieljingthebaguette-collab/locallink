# Security fix plan

## Status (2026-09-29)

All seven steps are done on this branch, one commit each, each checked
locally with `curl` against a throwaway DB (`DB_PATH` unset), plus
`npx tsc --noEmit` and `npm run build`. Decisions from review: pending
join-link claims are overwritten by later registrations (first to confirm
wins); the two extra findings were added as steps 6 and 7.

| Step | Commit | Verified by |
|---|---|---|
| 1 Uploads | `Check uploaded images by their bytes…` | HTML-as-PNG and SVG → 400; real PNG saved as `.png`; a `.html` already on disk serves with `Content-Disposition: attachment` + sandbox CSP |
| 2 Event sign-ups | `Refuse sign-ups on events that aren't approved` | pending → 400, approved → 200 |
| 3 Unapproved posts | `Hide pending and denied posts…` | pending: anon 404, volunteer 404, host 200, admin 200 |
| 4 Join links | `Make join links unguessable…` | old-style slug 404; attacker unverified and can't log in; real org confirming gets the badge; claimed link 404; late registrant gets nothing |
| 5 `err.message` | `Stop sending err.message…` | forced SQLite error: production → `Internal server error`, dev → real message; log line has no query string |
| 6 Admin email | `Make the admin address confirm its inbox…` | squatting the admin address → unverified, can't log in, still unverified after restart |
| 7 `optionalAuth` | `Read isAdmin from the users table in optionalAuth` | demoted admin's old token → 404 on a pending post; banned user treated as anonymous |

### Still to do, on production (can't be done from here)

- Uploads dir: list anything not `.png/.jpg/.jpeg/.webp/.gif`, copy aside, delete.
- Join links: delete unclaimed links whose slug has no 16-hex suffix
  (`WHERE claimedAt IS NULL AND slug NOT GLOB '*-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'`)
  and reissue from the admin panel.
- Join-link audit: check accounts on `claimedAt IS NOT NULL` links against
  the org name. After deploy, `claimedBy` with `claimedAt` NULL is only a
  *pending* claim, so filter on `claimedAt`, not `claimedBy`.
- Admin row: confirm the production `ADMIN_EMAIL` account exists and has
  `emailVerified = 1` (older boots set it; new boots no longer do).

---

Plan for the five findings in `security-actions.md` (review at `619c0dd`).
Line numbers below are from branch `security/fix-security-vulnerabilities`,
checked against the current code, not copied from the review.

**Constraints that apply to all of it** (from `CLAUDE.md`): no schema changes,
no production DB access from here, commit locally and show the diff, don't
push to main. Each finding is its own commit so any one can be reverted alone.

## Order

| Step | Finding | Severity | Why this position |
|---|---|---|---|
| 1 | #1 Upload stored XSS | High (15) | Highest risk; self-contained |
| 2 | #4 Signups on unapproved events | Low (4) | One-line move, no dependencies |
| 3 | #3 Unapproved posts readable by id | Low (2) | Small, same area as #4 |
| 4 | #2 Guessable join links | Medium (8) | Touches register + verify-email + client; needs one decision (below) |
| 5 | #5 `err.message` in 500s | Low (3) | ~63 call sites; last and alone, as the review asks |

---

## Step 1 — Uploads (#1)

**Files:** `server/routes.ts:26-45` (multer), `server/routes.ts:2521` (`POST /api/upload`), `server/index.ts:105` (`/uploads` static).

1. Switch multer to `memoryStorage()` (keeps the 5 MB limit). Drop the
   `mimetype` filter — it's client-controlled and gives false comfort.
2. In the route, sniff the first bytes of `req.file.buffer`:
   - PNG `89 50 4E 47 0D 0A 1A 0A` → `.png`
   - JPEG `FF D8 FF` → `.jpg`
   - GIF `47 49 46 38 37 61` / `…39 61` → `.gif`
   - WebP `52 49 46 46 ?? ?? ?? ?? 57 45 42 50` → `.webp`
   - Anything else, SVG included → `400 Only PNG, JPEG, WebP or GIF images are allowed`.
   No new dependency; a small helper function next to the multer config.
3. Write the buffer to `uploadsDir` as `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`,
   where `ext` comes only from step 2. `originalname` is never used.
   Response shape (`{ url: '/uploads/…' }`) is unchanged, so the three
   client callers (`CreatePostModal.tsx`, `my-events.tsx`, `profile.tsx`) need no change.
4. Second layer on `express.static('/uploads')` via `setHeaders`:
   - `Content-Security-Policy: sandbox; default-src 'none'` on every file
     (doesn't affect `<img>` embedding; neuters anything that does render).
   - `Content-Disposition: attachment` when the extension isn't
     `.png/.jpg/.jpeg/.webp/.gif` — covers any old file already on disk.
   - `nosniff` is already set by helmet; verify it's present rather than add it twice.

**Proof before calling it done:** locally (no `DB_PATH`), `curl` upload of
(a) a real PNG → 200 and the file serves as `image/png`; (b) an `.html`
sent as `Content-Type: image/png` → 400; (c) an `.html` dropped straight
into `uploads/` → served with `Content-Disposition: attachment` and the
sandbox CSP. Plus `npx tsc --noEmit` and `npm run build`.

**Yours, not mine (production):** list the prod uploads directory for
anything not `.png/.jpg/.jpeg/.webp/.gif`; copy it aside, then delete.

## Step 2 — Signups on unapproved events (#4)

**File:** `server/routes.ts` signup route, ~line 1276.

Move `if (opp.status !== 'approved')` above the `if (isRole)` block so it
covers events too. Keep the role wording for roles; events get
`This event is not open for sign-ups`. Nothing else in that block changes.

**Proof:** create a pending event locally, `curl` a signup as a second user → 400; approve it → 201.

## Step 3 — Unapproved posts readable by id (#3)

**File:** `server/routes.ts:1102-1114` (`GET /api/opportunities/:id`).

After loading `opp`, if `opp.status !== 'approved'`: allow only when
`req.userId === opp.hostId` or the user row says `isAdmin = 1` (a
`SELECT isAdmin FROM users WHERE id = ?` — not `req.isAdmin`, because
`optionalAuth` takes that from the token without checking the DB).
Otherwise return the same `404 Opportunity not found` as a missing id, so
status isn't leaked.

Check before shipping: the host's own "my posts" view and the admin
review queue — confirm neither opens pending posts through this endpoint
as someone other than host/admin (e.g. the `?post=ID` share link on a
pending post should now 404 for strangers, which is the intent).

**Proof:** `curl` a pending post anonymously → 404, as host → 200, as admin → 200.

## Step 4 — Join links (#2)

**Files:** `server/routes.ts:2709` (slug creation), `:556-584` (register),
`:661-704` (verify-email), `:2682` (public lookup); `client/src/pages/join.tsx`.

1. **Unguessable slugs.** `slugify(orgName) + '-' + randomBytes(8).toString('hex')`.
   Same `slug` column, no schema change. Existing links keep working.
2. **Link no longer verifies the email.** In register, `emailVerified`
   drops the `!!joinLink` term; `verified` starts at `0` for everyone. The
   normal confirmation email goes out. (Dev without `BREVO_API_KEY` still
   auto-verifies, as today.)
3. **Claim on confirmation, not on registration.** No new column needed:
   - Register with a valid unclaimed link → write `claimedBy = <new user id>`,
     leave `claimedAt` NULL (a pending claim).
   - `verify-email` → if a link has `claimedBy = userId AND claimedAt IS NULL`,
     set `claimedAt = now` and `users.verified = 1` in one transaction.
   - The auto-verified path (dev / admin email) claims immediately, same code.
   - **Decision needed** (see Questions): a later registration with the same
     link overwrites the pending `claimedBy`, so whoever *confirms their
     email* first gets the badge. An attacker can no longer use up a real
     organization's invite with an address they don't own.
4. **Lookup reveals less.** `GET /api/join/:slug` returns
   `{ slug, orgName, category }` for an unclaimed link and `404` for unknown
   *or* claimed. `join.tsx` drops its `claimedAt` branch; its 404 message
   becomes "This join link doesn't exist or has already been used" with the
   existing "Go to sign up" button. `category` stays because the account
   page uses it to prefill; it was set by an admin, not a secret.
5. Admin list (`admin.tsx:2000`) keys off `claimedAt` — pending claims will
   correctly show as unclaimed. No change needed there.
6. The Google-linking concern (password kept on an already-verified account)
   is closed by step 2: a join-link account is no longer verified until its
   owner confirms the inbox. No change to `google.ts` / the Google route.

**Proof:** locally with a stub `BREVO_API_KEY` so verification is required:
register with a link → `emailVerified=0, verified=0`, link `claimedAt` NULL;
hit the verify URL → `verified=1`, link claimed; a second registration on the
same link after that → no badge. Both themes/widths check on `join.tsx`.

**Yours, not mine (production):** delete unclaimed links in the old
name-only format and reissue; review `onboarding_links.claimedBy` accounts
against the org names on their links.

## Step 5 — `err.message` in 500s (#5)

**File:** `server/routes.ts`, 63 occurrences of `err.message`.

Add `serverError(res, err, label?)` next to the shared helpers: logs the
full error with `console.error`, responds `500` with `'Internal server error'`
when `NODE_ENV === 'production'`, else `err.message` (matches the global
handler in `index.ts:192-199`). Replace only the `catch` → `500` returns.
Leave intentional 4xx messages and the `console.error(... err.message)`
logging lines alone — they aren't sent to the client.

**Proof:** `grep -n "status(500).json({ error: err.message" server/routes.ts` returns nothing;
a forced error under `NODE_ENV=production` returns the generic message.

---

## Noticed while reading — not in the review, not in this plan

Reporting per `CLAUDE.md` ("report, don't fix unasked"):

- **Admin email at registration** (`routes.ts:569-571`): registering with
  `ADMIN_EMAIL` sets `isAdmin = 1` *and* `emailVerified = 1` with no inbox
  check. Harmless while the admin row exists (the duplicate-email check
  blocks it), but on a fresh or restored DB the first person to register
  that address is admin.
- **`optionalAuth` trusts the token's `isAdmin`** (`routes.ts:477`) while
  `requireAuth` re-reads it from the DB. A demoted admin keeps admin view
  on optional-auth routes for up to 30 days. Step 3 works around it locally;
  the root fix is in `optionalAuth` itself.

## Questions

1. **Step 4, pending claims:** OK with "latest registration overwrites the
   pending claim; first to confirm their email wins"? The alternative
   (first registrant holds the link until it expires) lets an attacker park
   on a real org's invite.
2. **Scope of the two extra findings above** — leave for later, or add as
   steps 6-7 on this branch?
3. **Pushing:** this branch is local only. Push `security/fix-security-vulnerabilities`
   to origin once steps land, or keep it local until you've reviewed?
