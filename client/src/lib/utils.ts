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
