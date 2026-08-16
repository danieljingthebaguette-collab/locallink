/**
 * Event dates are naive local strings — "2026-08-18T14:00", typed by an
 * organizer meaning 2pm where they live. They carry no offset, so comparing
 * them against `new Date().toISOString()` compares local wall-clock time
 * against UTC and silently drifts by the server's offset: on Railway, which
 * runs UTC, every time-based email fired about four hours early.
 *
 * The fix is to compare like with like. Instead of converting stored dates
 * to instants (impossible without knowing their zone), convert the instant
 * we're comparing against INTO the same naive local form.
 *
 * The zone is the community the site serves, not the server's. Override
 * with APP_TIMEZONE if that ever stops being true.
 */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';

/** An instant rendered as "YYYY-MM-DDTHH:mm" in the app's timezone — the
 * exact shape stored in opportunities.date, so string comparison between
 * them is a real time comparison. ISO 8601 sorts lexicographically, which
 * is what makes >= and <= work on these directly in SQL. */
export function toAppLocalString(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  // Intl renders midnight as 24 in some environments; normalise it.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/** Wall-clock hour (0–23) in the app's timezone. The scheduler's "Sunday
 * evening" window used the server's own hour, which on a UTC host meant
 * Sunday early afternoon for everyone actually reading the email. */
export function appLocalHour(d: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE, hour: '2-digit', hour12: false,
  }).format(d));
}

/** Day of week (0 = Sunday) in the app's timezone. */
export function appLocalDay(d: Date = new Date()): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE, weekday: 'short',
  }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}
