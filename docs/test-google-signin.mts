/**
 * Exercise the Google sign-in route without a real Google token.
 *
 * Patches OAuth2Client.verifyIdToken on the prototype BEFORE the server is
 * imported, so google.ts's client picks up the patched method. Everything after
 * that point -- the linking rules, the birth-year gate, username derivation,
 * the session -- is the real code.
 */
import { OAuth2Client } from 'google-auth-library';

// What "Google" will say for a given fake token.
const identities: Record<string, any> = {
  'tok-new':        { sub: 'g-new-1',   email: 'brand.new@gmail.com',        email_verified: true,  name: 'Brand New' },
  'tok-existing':   { sub: 'g-link-1',  email: 'rosterA@demo.test',          email_verified: true,  name: 'Maya Rodriguez' },
  'tok-unverified': { sub: 'g-unver-1', email: 'someone.else@gmail.com',     email_verified: false, name: 'Not Verified' },
  'tok-steal':      { sub: 'g-steal-1', email: 'rosterB@demo.test',          email_verified: false, name: 'Thief' },
  'tok-under13':    { sub: 'g-kid-1',   email: 'young@gmail.com',            email_verified: true,  name: 'Too Young' },
};

(OAuth2Client.prototype as any).verifyIdToken = async ({ idToken }: any) => {
  const p = identities[idToken];
  if (!p) throw new Error('bad token');
  return { getPayload: () => ({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, ...p }) };
};

const API = `http://localhost:${process.env.PORT}`;
// Relative, so this tests the server in whichever checkout it is run from.
await import('./server/index.ts');
await new Promise(r => setTimeout(r, 2500));

async function post(body: any) {
  const res = await fetch(`${API}/api/auth/google`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

let bad = 0;
const check = (ok: boolean, why: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${why}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) bad++;
};

// 1. Brand new person: verified, but we do not know their type or age yet.
let r = await post({ credential: 'tok-new' });
check(r.body.needsProfile === true, 'a new person is asked for the two things Google cannot tell us',
  JSON.stringify(r.body).slice(0, 90));
check(r.body.email === 'brand.new@gmail.com', 'and we hand back the address Google confirmed');

// 2. Still refused without a plausible birth year.
r = await post({ credential: 'tok-new', accountType: 'volunteer' });
check(r.body.needsProfile === true, 'a volunteer with no birth year is asked again, not created');

// 3. Under 13 refused outright.
r = await post({ credential: 'tok-under13', accountType: 'volunteer', birthYear: new Date().getFullYear() - 9 });
check(r.status === 403, 'under 13 is refused', `${r.status} ${JSON.stringify(r.body).slice(0, 70)}`);

// 4. Completed properly -> a real account and a session.
r = await post({ credential: 'tok-new', accountType: 'volunteer', birthYear: 2008 });
check(r.status === 200 && !!r.body.token, 'a completed signup returns a session',
  `${r.status} ${JSON.stringify(r.body).slice(0, 90)}`);
check(r.body.emailVerified === true, 'and the address counts as verified — no email to go and find');
check(r.body.fullName === 'Brand New', 'their real name comes from Google, ready for a certificate');
check(!!r.body.username && /^[a-zA-Z0-9_\- ]{3,30}$/.test(r.body.username),
  'a valid username was derived for them', String(r.body.username));

// 5. Same person again: straight in, no second account.
const first = r.body.id;
r = await post({ credential: 'tok-new' });
check(r.status === 200 && r.body.id === first, 'signing in again returns the SAME account, not a new one');

// 6. Somebody who already has a password account on that address gets linked.
r = await post({ credential: 'tok-existing' });
check(r.status === 200 && !!r.body.token, 'an existing password account links instead of duplicating',
  `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
check(r.body.email === 'rosterA@demo.test', 'and it is the same account, keeping their hours');

// 7. The attack that linking makes possible if you are careless.
r = await post({ credential: 'tok-steal' });
check(r.status === 403, 'an UNVERIFIED address cannot claim a stranger\'s existing account',
  `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);

// 8. And an unverified address cannot make a new account either.
r = await post({ credential: 'tok-unverified', accountType: 'volunteer', birthYear: 2008 });
check(r.status === 403, 'nor create a fresh one');

console.log(bad ? `\n${bad} FAILED` : '\nall pass');
process.exit(bad ? 1 : 0);
