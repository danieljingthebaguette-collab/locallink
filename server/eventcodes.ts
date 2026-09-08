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

/** 30 seconds. Long enough to scan, too short to text to a friend and have it
 *  still work by the time they open it. */
export const WINDOW_SECONDS = 30;

/** How many windows either side we accept. One covers a phone whose clock is a
 *  few seconds out, and someone who started scanning as the code turned over. */
const SKEW_WINDOWS = 1;

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
 * Is this what the organizer's phone showed recently?
 *
 * Compared without leaking timing, and only against the current window plus one
 * either side. Anything older has expired, which is the entire point.
 */
export function verifyLiveCode(secret: string, given: string, atMs: number = Date.now()): boolean {
  const candidate = String(given ?? '').trim().toUpperCase();
  if (candidate.length !== 6) return false;
  const given_ = Buffer.from(candidate);
  for (let d = -SKEW_WINDOWS; d <= SKEW_WINDOWS; d++) {
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

  // The whole security property: a texted screenshot goes stale.
  const code = liveCodeFor(secret, now);
  eq(verifyLiveCode(secret, code, now), true, 'the code on screen works');
  eq(verifyLiveCode(secret, code, now + 20_000), true, 'still works twenty seconds later');
  eq(verifyLiveCode(secret, code, now + 120_000), false, 'DEAD two minutes later — a texted photo is useless');
  eq(verifyLiveCode(secret, code, now - 120_000), false, 'and cannot be used ahead of time');

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
