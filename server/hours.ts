/**
 * Who confirmed an entry, and how much that is worth.
 *
 * The previous version keyed trust on a squashed organization NAME, which a
 * student types. Typing a confirmed charity's name therefore bought the highest
 * tier -- the top tier was easier to obtain fraudulently than the bottom one
 * was honestly. Everything here keys on something the student cannot type: the
 * account that posted the event, and the domain the approver's mail actually
 * came from.
 */

/** Providers where anyone can have an address in thirty seconds. Not a
 *  blocklist -- hours confirmed from these still count. It only decides which
 *  words appear next to the entry on the certificate. */
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'passport.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com', 'tutanota.com',
  'fastmail.com', 'hushmail.com', 'inbox.com', 'mail.ru', 'qq.com',
  // Throwaway services. Someone using one to confirm service hours is telling
  // us something, and we should be able to say it on the record.
  'mailinator.com', 'guerrillamail.com', 'yopmail.com', '10minutemail.com',
  'temp-mail.org', 'sharklasers.com', 'trashmail.com', 'getnada.com',
  'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'tempmail.com',
]);

export type ApproverKind = 'locallink_org' | 'org_domain' | 'personal';

/**
 * Fold an address down to the inbox it actually reaches.
 *
 * Gmail ignores dots in the local part and everything after a "+", so
 * "j.smith+dana@gmail.com" and "jsmith@gmail.com" are one inbox. A plain
 * string compare therefore let a student name themselves as their own
 * approver, which is the single cheapest way to farm unlimited hours.
 *
 * Sub-addressing with "+" is near-universal now (Outlook, iCloud, Fastmail,
 * most self-hosted mail), so the tag is stripped everywhere; dot-folding is
 * a Google-only behaviour and is only applied there.
 */
export function normaliseEmail(raw: string): string {
  const email = String(raw ?? '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return email;

  let local = email.slice(0, at);
  const domain = email.slice(at + 1);

  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
  }
  // Google treats the two domains as one account.
  const canonicalDomain = domain === 'googlemail.com' ? 'gmail.com' : domain;
  return `${local}@${canonicalDomain}`;
}

/** True when the two addresses reach the same inbox. */
export function sameInbox(a: string, b: string): boolean {
  return normaliseEmail(a) === normaliseEmail(b);
}

export function domainOf(email: string): string {
  const at = String(email ?? '').lastIndexOf('@');
  return at < 0 ? '' : String(email).slice(at + 1).toLowerCase().trim();
}

export function isFreeMail(email: string): boolean {
  return FREE_MAIL.has(domainOf(email));
}

/**
 * Which tier an entry earns.
 *
 * `hostEmail` is the address on the LocalLink account that posted the event,
 * when there is one. Matching it is the strongest signal we have, because the
 * student never chose it -- we did, from the post.
 */
export function approverKindFor(approverEmail: string, hostEmail?: string | null): ApproverKind {
  if (hostEmail && sameInbox(approverEmail, hostEmail)) return 'locallink_org';
  return isFreeMail(approverEmail) ? 'personal' : 'org_domain';
}

/** The words that go on the certificate. Said plainly, because a record that
 *  quietly mixes strong and weak evidence is the kind a school stops taking. */
export function describeKind(kind: ApproverKind | null, approverEmail?: string | null): string {
  switch (kind) {
    case 'locallink_org':
      return 'Confirmed by the organization on LocalLink';
    case 'org_domain':
      return approverEmail ? `Confirmed by ${approverEmail}` : 'Confirmed by an organization email';
    case 'personal':
      return approverEmail
        ? `Confirmed by ${approverEmail} (a personal email address)`
        : 'Confirmed by a personal email address';
    default:
      return 'Not confirmed';
  }
}

/** Only the top two tiers are what a school means by "verified". The third
 *  still appears on the record; it is just counted separately and labelled. */
export function isStrong(kind: ApproverKind | null): boolean {
  return kind === 'locallink_org' || kind === 'org_domain';
}

// ── check ───────────────────────────────────────────────────────────────────
// Run with:  npx tsx server/hours.ts
if (process.argv[1] && process.argv[1].endsWith('hours.ts')) {
  const eq = (got: unknown, want: unknown, why: string) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${why}  (got ${JSON.stringify(got)})`);
    if (!ok) process.exitCode = 1;
  };

  // The attack that mattered most: naming yourself through an alias.
  eq(sameInbox('jsmith@gmail.com', 'j.smith@gmail.com'), true, 'gmail dots are the same inbox');
  eq(sameInbox('jsmith@gmail.com', 'jsmith+dana@gmail.com'), true, 'gmail plus-tag is the same inbox');
  eq(sameInbox('jsmith@gmail.com', 'j.s.m.i.t.h+x@googlemail.com'), true, 'googlemail is gmail');
  eq(sameInbox('dana@arminarm.org', 'dana+vol@arminarm.org'), true, 'plus-tags strip everywhere');
  eq(sameInbox('dana@arminarm.org', 'd.ana@arminarm.org'), false, 'dots matter outside Google');
  eq(sameInbox('a@x.org', 'b@x.org'), false, 'different people are different');

  eq(approverKindFor('dana@arminarm.org'), 'org_domain', 'an organization domain');
  eq(approverKindFor('dana@gmail.com'), 'personal', 'a personal address');
  eq(approverKindFor('x@mailinator.com'), 'personal', 'a throwaway address');
  eq(approverKindFor('dana@arminarm.org', 'dana@arminarm.org'), 'locallink_org', 'the host themselves');
  eq(approverKindFor('dana+a@arminarm.org', 'dana@arminarm.org'), 'locallink_org', 'the host, aliased');
  eq(approverKindFor('someone@else.org', 'dana@arminarm.org'), 'org_domain', 'not the host');

  eq(isStrong('locallink_org'), true, 'LocalLink confirmation is strong');
  eq(isStrong('org_domain'), true, 'an organization email is strong');
  eq(isStrong('personal'), false, 'a personal address is counted separately');
  eq(isStrong(null), false, 'unconfirmed is not strong');

  eq(normaliseEmail('  DANA@ArmInArm.ORG '), 'dana@arminarm.org', 'trimmed and lowercased');
  eq(normaliseEmail('notanemail'), 'notanemail', 'garbage in, garbage out, no crash');

  console.log(process.exitCode ? '\nFAILED' : '\nall pass');
}
