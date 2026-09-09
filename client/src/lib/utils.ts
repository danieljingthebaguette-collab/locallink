import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Light guardrails on the location field — it renders as a Google Maps link,
// so catch obvious non-addresses (placeholder notes, schedule text) without
// blocking real-but-unusual addresses. Mirrored server-side in routes.ts.
const LOCATION_BLOCKLIST = ['will be given', 'sign up', 'tbd', 'beginning'];

export function getLocationError(location: string): string | null {
  const trimmed = location.trim();
  if (trimmed.length < 5) return 'Location must be at least 5 characters';
  if (trimmed.length > 100) return 'Location must be under 100 characters';
  const lower = trimmed.toLowerCase();
  if (LOCATION_BLOCKLIST.some(phrase => lower.includes(phrase))) {
    return "Location must be a real address or place name, not a note (avoid phrases like 'sign up' or 'TBD')";
  }
  return null;
}

// Optional external signup URL on a post — validated only when non-blank.
// Mirrored server-side in routes.ts.
export function getExternalSignupUrlError(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'Enter a full web address, starting with http:// or https://';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Signup page must start with http:// or https://';
  }
  return null;
}

/**
 * "Tomorrow", "This Saturday", "In 12 days" — how far off an event is, in the
 * terms people actually think in. An absolute date makes you do the arithmetic
 * yourself; a relative one is why a thing feels close enough to act on. Returns
 * null past ~3 weeks, where "in 47 days" stops meaning anything useful and the
 * plain date reads better.
 *
 * Deliberately compares calendar days, not elapsed hours, so an event at 9am
 * tomorrow reads "Tomorrow" rather than "Today" just because it is under 24
 * hours away.
 */
export function getRelativeDay(iso: string, now: Date = new Date()): string | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(then) - startOf(now)) / 86_400_000);

  if (days < 0) return null;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  // Inside the coming week, the weekday name is the most natural handle.
  if (days < 7) return `This ${then.toLocaleDateString('en-US', { weekday: 'long' })}`;
  if (days < 14) return 'Next week';
  if (days <= 21) return `In ${days} days`;
  return null;
}

/**
 * Length caps for free text. Mirrored in server/routes.ts -- keep the two in
 * sync; the server is the one that actually enforces them, since the form can
 * be bypassed entirely by posting to the API.
 *
 * Generous rather than tight: the point is to stop a megabyte of text and an
 * unwrappable 300-character word breaking the board, not to police how much
 * an organizer writes about their event.
 */
export const LIMITS = {
  title: 120,
  description: 2000,
  location: 200,
  step: 200,
  steps: 12,
  orgDescription: 1500,
  externalSignupUrl: 500,
} as const;

/** Returns an error when `value` is over the cap for `field`, else null. */
export function getLengthError(field: keyof typeof LIMITS, value: string): string | null {
  const max = LIMITS[field];
  const len = value.trim().length;
  return len > max ? `Keep this under ${max} characters (currently ${len})` : null;
}

/**
 * Dates reach us in two shapes and cannot be read the same way.
 *
 * A *service date* is a plain day somebody typed — "2026-08-15", no timezone
 * attached. Handing that to `new Date()` reads it as midnight UTC, which is the
 * previous evening for everyone in New Jersey, so the day shown is one behind.
 * Pinning it to local noon avoids that in every timezone.
 *
 * An *issued date* is a real moment we recorded — "2026-09-08T00:34:29Z". That
 * one has to be shown in the reader's own timezone, or a certificate made at
 * 8pm is stamped tomorrow. On a document a school is meant to trust, a date in
 * the future reads as a forgery.
 *
 * The two are told apart by whether the string carries a timezone at all.
 */
export function formatDay(iso: string, style: 'short' | 'long' = 'short'): string {
  const isRealMoment = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = isRealMoment ? new Date(iso) : new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('en-US', style === 'long'
    ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Has this actually finished?
 *
 * Three places compared the START time against now, so an event that was
 * happening at that moment showed as ended: the board card got an ENDED badge
 * and the post replaced its buttons with "This event has ended". Harmless while
 * the only thing you could do was say you were interested beforehand.
 *
 * Not harmless now. Somebody standing at the event, phone out, can scan in and
 * record hours — while the page telling them about it says it is over. A grace
 * hour past the posted finish, because events run long and this only decides
 * whether we stop offering things.
 */
export function hasEnded(date: string, durationHours?: number | null, isRecurring?: boolean): boolean {
  if (isRecurring) return false;          // recurring posts never end
  const start = new Date(date).getTime();
  if (Number.isNaN(start)) return false;  // unparseable: do not hide the CTA
  return Date.now() > start + ((Number(durationHours) || 0) + 1) * 36e5;
}
