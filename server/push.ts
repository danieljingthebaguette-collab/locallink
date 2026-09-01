import webpush from 'web-push';
import db from './db.js';

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:linklocal2@gmail.com';

/**
 * Push is optional. With no keys configured the whole thing turns itself off
 * rather than throwing on every notification -- the site keeps working, people
 * just get the in-site bell and email as before. Same shape as the Brevo key
 * being absent locally.
 */
export const pushEnabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
} else {
  console.warn('[push] VAPID keys not set — web push disabled, notifications stay in-site only.');
}

export function getPublicKey(): string {
  return PUBLIC_KEY;
}

export function saveSubscription(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }): void {
  // Keyed on endpoint, which is the browser's own identifier for this
  // installation. REPLACE rather than INSERT because the same endpoint can come
  // back for a different account when two people share a device.
  db.prepare(
    `INSERT OR REPLACE INTO push_subscriptions (endpoint, userId, p256dh, auth, createdAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth, new Date().toISOString());
}

export function removeSubscription(endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function countSubscriptions(userId: string): number {
  return (db.prepare('SELECT COUNT(*) as c FROM push_subscriptions WHERE userId = ?').get(userId) as any).c;
}

/**
 * Fire a push to every device a person has registered. Never throws: a failed
 * push must not take down whatever action triggered it, and a person with a
 * stale subscription should not be able to break someone else's signup.
 *
 * A 404 or 410 from the push service means the subscription is dead -- the
 * browser was uninstalled, or permission was revoked -- so it is deleted rather
 * than retried forever.
 */
export async function sendPush(
  userId: string,
  payload: { title: string; body: string; url?: string }
): Promise<number> {
  if (!pushEnabled) return 0;
  const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE userId = ?').all(userId) as any[];
  let delivered = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      delivered++;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) removeSubscription(s.endpoint);
    }
  }
  return delivered;
}
