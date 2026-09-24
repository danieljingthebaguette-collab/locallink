# Security actions

From a security review of the whole codebase at commit `619c0dd` (2026-09-23).
Findings come from reading the code, not from running exploits.

## How the ratings work

Each finding gets a **Likelihood** score (L) and a **Consequence** score (C), each from 1 to 5.
**Risk = L × C.**

| Score | Likelihood | Consequence |
|---|---|---|
| 1 | Rare: needs something close to impossible, such as guessing a UUID | Negligible: cosmetic, or no user data involved |
| 2 | Unlikely: needs a narrow window or insider knowledge | Minor: small leak of non-sensitive data, or a bit of junk data |
| 3 | Possible: anyone with a free account can do it, but a victim has to do something | Moderate: one user's non-sensitive data, or impersonation that admin review would catch |
| 4 | Likely: can be done without any help from a victim | Major: one account taken over, or minors exposed to someone impersonating an organization |
| 5 | Almost certain: automated, needs nothing from anyone | Severe: an admin account taken over, or data about many minors exposed |

The score decides the severity:

| Risk | Severity | Response |
|---|---|---|
| 20–25 | **Critical** | Stop and fix now. Turn the feature off if a fix will take a while |
| 12–19 | **High** | Fix before anything else ships |
| 6–11 | **Medium** | Fix this cycle |
| 1–5 | **Low** | Fix when you're working in that code anyway |

Nothing in this review scored Critical.

## Summary

| # | Finding | L | C | Risk | Severity |
|---|---|---|---|---|---|
| 1 | Uploads can be HTML or JS, which becomes stored XSS on the site's own domain | 3 | 5 | **15** | **High** |
| 2 | Join links can be guessed and give a verified org account with no email check | 2 | 4 | **8** | **Medium** |
| 3 | Pending and denied posts can be read by anyone who has the id | 1 | 2 | 2 | Low |
| 4 | Volunteers can sign up for events that haven't been approved | 2 | 2 | 4 | Low |
| 5 | 500 errors send `err.message` back to the client | 3 | 1 | 3 | Low |

---

## 1. Uploads can be HTML or JS, which becomes stored XSS on the site's own domain (High, 15)

**Where:** [server/routes.ts:26-45](server/routes.ts#L26-L45) (multer config), [server/routes.ts:2521](server/routes.ts#L2521) (`POST /api/upload`), [server/index.ts:105](server/index.ts#L105) (`/uploads` static).

**What's wrong:**
- The upload filter only checks `file.mimetype`, which the client sets itself.
- The stored file keeps the client's extension.
- `express.static` sets the file type from that extension.

So an upload named `.html` is served as a page, and one named `.js` is served as a script, both from the site's own domain. The security policy allows scripts from the site's own domain, so an uploaded `.js` runs when an uploaded `.html` loads it. That script can read `localStorage.locallink_token` and send it to the attacker by redirecting the browser to their site.

**L = 3:** any free account can upload, including a 13-year-old's. The victim has to open a link, but it's on the real domain, so it looks trustworthy.
**C = 5:** the attacker gets a 30-day login token. If an admin opens the link, the attacker gets the whole admin panel and every user's email address.

**Action items**
- [ ] Check the file's first bytes against a short list of image formats: PNG, JPEG, WebP, GIF. Refuse anything else, **including SVG**.
- [ ] Choose the extension on the server from that check. Never use `path.extname(file.originalname)`.
- [ ] Set headers on the `/uploads` static route as a second layer: `X-Content-Type-Options: nosniff` (helmet already sets this), `Content-Security-Policy: sandbox; default-src 'none'`, and `Content-Disposition: attachment` for any extension that isn't an image.
- [ ] Check the production uploads directory (next to `DB_PATH`) for anything that isn't `.png`, `.jpg`, `.jpeg`, `.webp` or `.gif`. Anything else is either a probe or an attack, so keep a copy before deleting it.
- [ ] Confirm the fix: upload a `.html` with `Content-Type: image/png` locally, and check that it's refused, or at least that it comes back as a download and doesn't render.

---

## 2. Join links can be guessed and give a verified org account with no email check (Medium, 8)

**Where:** [server/routes.ts:2709](server/routes.ts#L2709) (slug made from the org name), [server/routes.ts:557-573](server/routes.ts#L557-L573) (what registering with a link grants), [server/routes.ts:2682](server/routes.ts#L2682) (public slug lookup), [server/routes.ts:2817-2819](server/routes.ts#L2817-L2819) (Google linking).

**What's wrong:**
- A join link's slug is just the org name in lowercase with dashes, so the name is the only secret.
- Registering with an unclaimed slug sets `emailVerified = 1` for any address typed, and `verified = 1`. That badge is the only check `canPostRoles` makes.
- Google linking keeps the existing password on an account that's already verified.

Put together, an attacker can make an account under someone else's Gmail address, mark it verified, and keep their own password after the real owner signs in with Google.

**L = 2:** it only works while an invite link is unclaimed, and the attacker has to guess which organizations have been invited. The public lookup at `GET /api/join/:slug` makes checking a guess free.
**C = 4:** the attacker gets an account showing the verified badge under a real organization's name, one allowed to post ongoing roles aimed at minors, and possibly someone else's account. Admin approval of posts limits the first part.

**Action items**
- [ ] Add a random suffix to new slugs, e.g. `hillsborough-food-pantry-` plus 16 hex characters from `randomBytes(8)`. This uses the existing `slug` column, so **no schema change**.
- [ ] Stop the link from setting `emailVerified`. Send the normal confirmation email, and keep only `verified = 1` from the link.
- [ ] Only mark the link claimed once the email is confirmed, so an attacker can't use up a real organization's invite with an address they don't own.
- [ ] Have `GET /api/join/:slug` return only whether the link is valid (`{ orgName }`), without `claimedAt`.
- [ ] Look at any unclaimed links in production that use the old guessable format. Delete them and send new ones.
- [ ] Check which accounts in production registered with a join link (`onboarding_links.claimedBy`), and confirm each one really belongs to the organization named on the link.

---

## 3. Pending and denied posts can be read by anyone who has the id (Low, 2)

**Where:** [server/routes.ts:1102-1114](server/routes.ts#L1102-L1114) (`GET /api/opportunities/:id`).

**What's wrong:** there's no `status = 'approved'` filter. A post an admin denied, possibly for bad content, can still be read by anyone who has its URL.

**L = 1:** post ids are UUIDs, so someone would have to be given the link.
**C = 2:** only the post's own contents are exposed, and they were written by the organization.

**Action items**
- [ ] Return 404 for posts that aren't approved, unless the person asking is the host or an admin. `optionalAuth` already provides `req.userId`, but check admin status against the database, not the token's `isAdmin`.

---

## 4. Volunteers can sign up for events that haven't been approved (Low, 4)

**Where:** [server/routes.ts:1256-1318](server/routes.ts#L1256-L1318).

**What's wrong:** roles check `opp.status !== 'approved'` before accepting an application, but events don't. Calling the API directly registers interest in a pending or denied event. The host gets a notification, and the volunteer's email lands on the host's list of interested volunteers.

**L = 2:** someone has to call the API directly and have the post's id.
**C = 2:** junk signups, and a volunteer's email reaching an organization whose post was never approved.

**Action items**
- [ ] Move the status check out of the `if (isRole)` block so it applies to both kinds of post.

---

## 5. 500 errors send `err.message` back to the client (Low, 3)

**Where:** every route's `catch` block in [server/routes.ts](server/routes.ts), for example [line 608](server/routes.ts#L608).

**What's wrong:** the global error handler in `index.ts` hides error messages in production, but each route's own `catch` returns `err.message` directly. That leaks SQLite errors, table names and constraint names.

**L = 3:** any malformed request that causes an error will do it.
**C = 1:** it only reveals details about the database structure. Neither report finding depends on it.

**Action items**
- [ ] Add a helper, e.g. `serverError(res, err)`, that logs the full error and returns `'Internal server error'` when `NODE_ENV === 'production'`, the same way the global handler does. Then replace the per-route returns with it. This touches almost every route, so do it separately from other changes.

---

## Checked and found clean

- **SQL injection:** every query uses bound parameters. `NUDGE_TARGETS` only inserts fixed text from the code.
- **Emails:** every user-supplied value in HTML email bodies goes through `escapeHtml`.
- **Link previews for social sites** ([server/index.ts:127](server/index.ts#L127)): every value is escaped.
- **`orgWebsite` used as an `href`:** React 19 and the security policy both block `javascript:` links.
- **Google sign-in:** it checks the token's signature, intended recipient and issuer, and only links accounts on addresses Google says are verified. The only hole is the one in finding 2.
- **`server/database.sqlite` in git:** it's 0 bytes, so no data is exposed.
