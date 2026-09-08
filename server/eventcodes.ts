import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * The two codes an event has, and why they are not the same code.
 *
 * PRINTED  — static, one per event, taped to a table. It can only START a
 *            clock. Volunteers drift in over twenty minutes and nobody should
 *            have to stand at the door holding a phone up for all of it.
 *
 * LIVE     — on the organizer's phone, redrawn every 30 seconds. It can start
 *            or STOP a clock.
 *
 * The split is what makes a photographed printed code nearly worthless. Someone
 * at home can scan a texted photo and open a clock, but they cannot close it
 * without standing next to the organizer, and an unclosed clock pays the posted
 * length and lands on the organizer's list marked as never scanned out. The
 * fraud earns a flag rather than hours.
 *
 * The live code is derived rather than stored: HMAC of the event's secret and
 * the current 30-second window. Nothing to write, nothing to clean up, and it
 * cannot be leaked from the database because it does not live there.
 */

/** A fresh code is drawn every 30 seconds, so the organizer's screen is always
 *  showing something recent and there is no long-lived secret on the table. */
export const WINDOW_SECONDS = 30;

/**
 * But each code keeps working for two minutes after it appears.
 *
 * The two are deliberately different. Thirty seconds of validity assumes
 * everyone scanning is quick and confident with a phone, and plenty of people
 * are not -- an older volunteer, someone with shaky hands, anyone fumbling in
 * the cold at the end of a shift. Failing them at the last step, after they
 * have done the work, is a worse outcome than the fraud this window is guarding
 * against.
 *
 * So codes overlap: at any moment the last four are all accepted. The cost is
 * that a texted screenshot stays usable for up to two minutes instead of one,
 * which is a real widening -- but the accomplice still has to be logged in and
 * waiting, and a far easier attack (two people sharing one phone) is open
 * anyway. Spending accessibility to close the harder door while the easier one
 * stands open would buy nothing.
 */
export const CODE_LIFETIME_SECONDS = 120;

/**
 * How many past windows a code stays good for.
 *
 * Note the ceil rather than a subtraction. A code appears at some point inside
 * its window and is used at some point inside a later one, so accepting N
 * windows back guarantees only (N-1) x 30 seconds of life -- the unlucky code
 * is the one drawn just before a boundary. Rounding up is what makes two
 * minutes a floor for every code rather than a best case for some of them.
 */
const LIFETIME_WINDOWS = Math.ceil(CODE_LIFETIME_SECONDS / WINDOW_SECONDS);

/** One window forward, for a phone whose clock runs slightly fast. */
const FORWARD_WINDOWS = 1;

/** No I, O, 0 or 1 — the organizer may end up reading this out loud. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newEventSecret(): string {
  return randomBytes(32).toString('hex');
}

/** The static code that goes on the printed sheet. Long enough that it cannot
 *  be guessed by anyone who did not come to the event. */
export function newPrintedCode(): string {
  return randomBytes(16).toString('hex');
}

function windowAt(atMs: number): number {
  return Math.floor(atMs / 1000 / WINDOW_SECONDS);
}

/** The six characters showing on the organizer's phone right now. */
export function liveCodeFor(secret: string, atMs: number = Date.now()): string {
  const mac = createHmac('sha256', secret).update(String(windowAt(atMs))).digest();
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[mac[i] % ALPHABET.length];
  return out;
}

/** Seconds until the code on screen is replaced. Drives the countdown ring. */
export function secondsLeft(atMs: number = Date.now()): number {
  return WINDOW_SECONDS - Math.floor((atMs / 1000) % WINDOW_SECONDS);
}

/**
 * Is this what the organizer's phone showed in the last two minutes?
 *
 * Compared without leaking timing. Anything older than the lifetime has
 * expired, which is the entire point -- but the lifetime is generous enough
 * that nobody is punished for being slow with a camera.
 */
export function verifyLiveCode(secret: string, given: string, atMs: number = Date.now()): boolean {
  const candidate = String(given ?? '').trim().toUpperCase();
  if (candidate.length !== 6) return false;
  const given_ = Buffer.from(candidate);
  // Walk back over every code still inside its lifetime, plus one ahead.
  for (let d = -LIFETIME_WINDOWS; d <= FORWARD_WINDOWS; d++) {
    const expect = Buffer.from(liveCodeFor(secret, atMs + d * WINDOW_SECONDS * 1000));
    if (expect.length === given_.length && timingSafeEqual(expect, given_)) return true;
  }
  return false;
}

// ── check ───────────────────────────────────────────────────────────────────
// npx tsx server/eventcodes.ts
if (process.argv[1] && process.argv[1].endsWith('eventcodes.ts')) {
  const eq = (got: unknown, want: unknown, why: string) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${why}`);
    if (!ok) { console.log(`      got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); process.exitCode = 1; }
  };

  const secret = newEventSecret();
  const now = 1_800_000_000_000; // a fixed instant, so this never flakes

  eq(liveCodeFor(secret, now).length, 6, 'the live code is six characters');
  eq(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(liveCodeFor(secret, now)), true,
     'no characters people misread');
  eq(liveCodeFor(secret, now), liveCodeFor(secret, now + 1000),
     'stable within its own 30-second window');

  // A code has to outlive the person scanning it, however slow they are...
  const code = liveCodeFor(secret, now);
  eq(verifyLiveCode(secret, code, now), true, 'the code on screen works');
  eq(verifyLiveCode(secret, code, now + 20_000), true, 'still works twenty seconds later');
  eq(verifyLiveCode(secret, code, now + 60_000), true, 'still works a minute later — no rush');
  eq(verifyLiveCode(secret, code, now + 119_000), true, 'still works at one fifty-nine');

  // The unlucky code: drawn a moment before its window turns over, so it has
  // the least life of any. Two minutes has to hold for this one too, or the
  // promise is only true on average.
  const lateInWindow = now + WINDOW_SECONDS * 1000 - 1000;
  const unlucky = liveCodeFor(secret, lateInWindow);
  eq(verifyLiveCode(secret, unlucky, lateInWindow + 119_000), true,
     'even a code drawn a second before the turnover lasts two minutes');

  // ...and then stop, or the window it opens never closes.
  eq(verifyLiveCode(secret, code, now + 160_000), false, 'DEAD not long after');
  eq(verifyLiveCode(secret, code, now + 600_000), false, 'and long dead ten minutes later');
  eq(verifyLiveCode(secret, code, now - 120_000), false, 'cannot be used ahead of time');

  // Codes overlap on purpose: several are live at once, which is what buys the
  // slow scanner their two minutes.
  const older = liveCodeFor(secret, now - 60_000);
  eq(older !== code, true, 'a code from a minute ago is a different code');
  eq(verifyLiveCode(secret, older, now), true, 'and it still works — the windows overlap');

  eq(verifyLiveCode(newEventSecret(), code, now), false, "another event's code does not work here");
  eq(verifyLiveCode(secret, 'ABCDEF', now), false, 'a guess does not work');
  eq(verifyLiveCode(secret, '', now), false, 'empty is refused');
  eq(verifyLiveCode(secret, code.toLowerCase(), now), true, 'typed in lower case still works');
  eq(verifyLiveCode(secret, ` ${code} `, now), true, 'stray spaces are forgiven');
  eq(verifyLiveCode(secret, code + 'X', now), false, 'wrong length is refused, not truncated');

  const s2 = secondsLeft(now);
  eq(s2 >= 1 && s2 <= WINDOW_SECONDS, true, 'the countdown is inside the window');

  eq(newPrintedCode().length, 32, 'the printed code is long enough not to guess');
  eq(newPrintedCode() === newPrintedCode(), false, 'printed codes are unique');

  console.log(process.exitCode ? '\nFAILED' : '\nall pass');
}
