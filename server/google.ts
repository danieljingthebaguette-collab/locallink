import { OAuth2Client } from 'google-auth-library';

/**
 * Signing in with Google.
 *
 * The point of it here is not convenience, it is that Google tells us the email
 * address is real. Our own verification email currently fails DMARC and may
 * never arrive, so for a new volunteer standing at an event with a QR code in
 * front of them, "go and find our email" is where we lose them. Google removes
 * that step entirely, and the password with it.
 *
 * Dormant until GOOGLE_CLIENT_ID is set. With no id configured the button never
 * renders and every route here refuses, so shipping this changes nothing until
 * somebody deliberately turns it on.
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

export const googleEnabled = (): boolean => CLIENT_ID.length > 0;

/** The client id is public by design -- it ends up in the page source either
 *  way, and Google's security rests on the authorised-origins list, not on
 *  keeping it quiet. Served rather than baked into the build so turning this on
 *  is an environment variable and a restart, not a rebuild. */
export const googleClientId = (): string => CLIENT_ID;

/** Built once. The library caches Google's signing keys and rotates them. */
const client = new OAuth2Client(CLIENT_ID);

/**
 * Fold an address down to the inbox it actually reaches.
 *
 * Gmail ignores dots in the local part and everything after a "+", so
 * "j.smith+x@gmail.com" and "jsmith@gmail.com" are one inbox. Linking a Google
 * account to an existing password account compares inboxes rather than strings,
 * or the same person quietly ends up with two accounts and their hours split
 * between them.
 */
export function normaliseEmail(raw: string): string {
  const email = String(raw ?? '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  let local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '');
  return `${local}@${domain === 'googlemail.com' ? 'gmail.com' : domain}`;
}

export interface GoogleIdentity {
  sub: string;        // Google's own id. Stable; the email is not.
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/**
 * Turn the token the browser handed us into an identity we can trust.
 *
 * Everything here rests on verifyIdToken, which checks the signature against
 * Google's published keys and checks that the token was issued FOR US and has
 * not expired. Skipping that and reading the payload would mean anyone could
 * hand us a made-up token and log in as anybody -- the tokens are ordinary JWTs
 * and the interesting half is the signature.
 *
 * Returns null rather than throwing, because every failure here is the same
 * answer to the caller: this is not somebody we can sign in.
 */
export async function verifyGoogleToken(idToken: string): Promise<GoogleIdentity | null> {
  if (!googleEnabled()) return null;
  if (!idToken || typeof idToken !== 'string') return null;

  try {
    const ticket = await client.verifyIdToken({ idToken, audience: CLIENT_ID });
    const p = ticket.getPayload();
    if (!p) return null;

    // Belt and braces. verifyIdToken already checks aud, exp and iss, but the
    // issuer check is cheap and this is the one place where being wrong means
    // handing somebody another person's account.
    const issuerOk = p.iss === 'accounts.google.com' || p.iss === 'https://accounts.google.com';
    if (!issuerOk) return null;
    if (!p.sub || !p.email) return null;

    return {
      sub: p.sub,
      email: String(p.email).trim().toLowerCase(),
      // Google can return an unverified address. Linking to an existing account
      // on an unverified email would let somebody claim a stranger's volunteer
      // record by registering their address with Google and never proving it.
      emailVerified: p.email_verified === true,
      name: p.name ? String(p.name).trim() : null,
    };
  } catch {
    return null;
  }
}

/**
 * A username from whatever Google gave us, made to fit our own rule
 * (3-30 characters, letters, numbers, spaces, hyphens, underscores) and made
 * unique by the caller's `taken` check.
 *
 * Derived rather than asked for: it is one more field on a screen whose whole
 * purpose is being short, and nobody chose their LocalLink username carefully
 * anyway now that the certificate prints their real name instead.
 */
export function usernameFrom(name: string | null, email: string, taken: (u: string) => boolean): string {
  const fromName = (name ?? '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 24);
  const fromEmail = email.split('@')[0].replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 24);
  let base = fromName.length >= 3 ? fromName : fromEmail;
  if (base.length < 3) base = 'volunteer';

  if (!taken(base)) return base;
  // Numbered rather than random: "Ava Lin 2" reads like a person, "Ava_9f3c"
  // reads like a database.
  for (let i = 2; i < 500; i++) {
    const candidate = `${base.slice(0, 26)} ${i}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base.slice(0, 20)} ${Date.now().toString().slice(-6)}`;
}

// ── check ───────────────────────────────────────────────────────────────────
// npx tsx server/google.ts
if (process.argv[1] && process.argv[1].endsWith('google.ts')) {
  const eq = (got: unknown, want: unknown, why: string) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${why}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
    if (!ok) process.exitCode = 1;
  };
  const free = () => false;
  const only = (...used: string[]) => (u: string) => used.includes(u);

  eq(usernameFrom('Ava Lin', 'ava@x.com', free), 'Ava Lin', 'uses the name Google gave');
  eq(usernameFrom(null, 'ava.lin@gmail.com', free), 'avalin', 'falls back to the address');
  eq(usernameFrom('Ω', 'ava@x.com', free), 'ava', 'a name with nothing usable falls back to the address');
  // "zz" is two characters and our own rule wants three, so the address is no
  // use either and it lands on the generic name rather than something invalid.
  eq(usernameFrom('Ω', 'zz@x.com', free), 'volunteer', 'a too-short address falls back again');
  eq(usernameFrom('', '@x.com', free), 'volunteer', 'nothing usable at all still yields something valid');
  eq(usernameFrom('Ava Lin', 'a@x.com', only('Ava Lin')), 'Ava Lin 2', 'numbers up when taken');
  eq(usernameFrom('Ava Lin', 'a@x.com', only('Ava Lin', 'Ava Lin 2')), 'Ava Lin 3', 'keeps going');
  eq(/^[a-zA-Z0-9_\- ]{3,30}$/.test(usernameFrom('Ava<>Lin!!', 'a@x.com', free)), true,
     'always passes the rule registration enforces');
  eq(/^[a-zA-Z0-9_\- ]{3,30}$/.test(usernameFrom('x'.repeat(80), 'a@x.com', free)), true,
     'a very long name is still within 30');

  // The refusals that matter.
  const noId = !process.env.GOOGLE_CLIENT_ID;
  eq(googleEnabled(), !noId, 'disabled unless a client id is configured');
  verifyGoogleToken('not-a-token').then(r => {
    eq(r, null, 'a made-up token is refused');
    console.log(process.exitCode ? '\nFAILED' : '\nall pass');
  });
}
