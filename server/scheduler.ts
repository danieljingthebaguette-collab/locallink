/**
 * Recurring-reopen scheduler
 *
 * Logic:
 *   • Runs a check once every hour.
 *   • On Sundays between 18:00–18:59 (server local time), finds every user who has
 *     signed up for a recurring opportunity and sends them:
 *       – an in-app notification (type: 'reopen')
 *       – an email reminder
 *   • Deduplication: skips the notification if a 'reopen' notification for the same
 *     userId + postId already exists in the last 6 days, so restarting the server or
 *     multiple ticks within the same hour never double-sends.
 */

import { randomUUID } from 'crypto';
import db from './db.js';
import { sendReopenReminderEmail } from './email.js';

type SignupRow = {
  postId: string;
  title: string;
  userId: string;
  email: string;
  username: string;
  notifyOnReopen: number; // 0 or 1 from SQLite
};

async function checkAndNotify(): Promise<void> {
  try {
    const now = new Date();
    const day  = now.getDay();   // 0 = Sunday
    const hour = now.getHours(); // 0–23

    // Only send on Sunday evenings (18:00–18:59 local server time)
    if (day !== 0 || hour !== 18) return;

    console.log('[Scheduler] Sunday 18:xx — scanning for recurring-reopen notifications…');

    // All users signed up for recurring opportunities (exclude banned accounts)
    const rows = db.prepare(`
      SELECT
        o.id              AS postId,
        o.title           AS title,
        u.id              AS userId,
        u.email           AS email,
        u.username        AS username,
        u.notifyOnReopen  AS notifyOnReopen
      FROM opportunities o
      JOIN signups s ON s.opportunityId = o.id
      JOIN users   u ON u.id = s.userId
      WHERE o.isRecurring = 1
        AND u.email IS NOT NULL
        AND (u.banned IS NULL OR u.banned = 0)
    `).all() as SignupRow[];

    if (rows.length === 0) {
      console.log('[Scheduler] No recurring signups found — nothing to do.');
      return;
    }

    // Deduplication window: 6 days (covers the full prior week)
    const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();

    const checkDup = db.prepare(
      `SELECT id FROM notifications
       WHERE type = 'reopen' AND userId = ? AND postId = ? AND createdAt > ?`
    );
    const insertNotif = db.prepare(
      `INSERT INTO notifications (id, userId, type, message, postId, read, createdAt)
       VALUES (?, ?, 'reopen', ?, ?, 0, ?)`
    );

    let notified = 0;
    for (const row of rows) {
      // Skip if already notified within the past 6 days
      const dup = checkDup.get(row.userId, row.postId, sixDaysAgo);
      if (dup) continue;

      const createdAt = now.toISOString();
      const message = `"${row.title}" reopens tomorrow (Monday) — sign up again!`;

      // Insert in-app notification (always)
      insertNotif.run(randomUUID(), row.userId, message, row.postId, createdAt);

      // Send email only if the user has email reminders enabled (default: on)
      // notifyOnReopen is stored as 0/1; NULL (new column, not yet set) defaults to ON
      if (row.notifyOnReopen !== 0) {
        sendReopenReminderEmail(row.email, row.username, row.title).catch((err: Error) => {
          console.error(`[Scheduler] Email failed for ${row.email}: ${err.message}`);
        });
      }

      notified++;
    }

    console.log(`[Scheduler] Reopen reminders queued for ${notified} user(s).`);
  } catch (err: any) {
    console.error('[Scheduler] Unexpected error:', err.message);
  }
}

/** Call once at server startup to register the hourly interval. */
export function startReopenScheduler(): void {
  // Run the first check immediately (deduplication makes this safe on restarts)
  checkAndNotify();
  // Then run every hour
  setInterval(checkAndNotify, 60 * 60 * 1000);
  console.log('[Scheduler] Reopen-reminder scheduler started (checks every hour, fires Sunday 18:xx).');
}
