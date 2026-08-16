import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In production set DB_PATH to a persistent disk location (e.g. /data/locallink.db on Fly.io/Railway)
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'locallink.db');

mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    isAdmin INTEGER DEFAULT 0,
    emailVerified INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_verifications (
    token TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    date TEXT NOT NULL,
    duration REAL NOT NULL,
    spots INTEGER NOT NULL,
    spotsRemaining INTEGER NOT NULL,
    spotsType TEXT DEFAULT 'limited',
    image TEXT,
    hostId TEXT NOT NULL,
    hostName TEXT NOT NULL,
    popularity INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS favorites (
    userId TEXT NOT NULL,
    orgId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    PRIMARY KEY (userId, orgId),
    FOREIGN KEY (userId) REFERENCES users(id),
    FOREIGN KEY (orgId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunityId TEXT NOT NULL,
    userId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (opportunityId) REFERENCES opportunities(id),
    FOREIGN KEY (userId) REFERENCES users(id),
    UNIQUE(opportunityId, userId)
  );

  -- Attendance is deliberately separate from signups: a signup means "tapped
  -- Interested," this means "actually checked in and out at the event." A
  -- volunteer can have one without the other. occurrenceDate (not just
  -- opportunityId) is what lets a recurring weekly event have a fresh
  -- check-in every week instead of the unique constraint blocking it after
  -- the first Saturday.
  CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    opportunityId TEXT NOT NULL,
    userId TEXT NOT NULL,
    occurrenceDate TEXT NOT NULL,
    checkInAt TEXT NOT NULL,
    checkOutAt TEXT DEFAULT NULL,
    hoursClaimed REAL DEFAULT NULL,
    hoursVerified REAL DEFAULT NULL,
    status TEXT DEFAULT 'checked_in',
    verifiedBy TEXT DEFAULT NULL,
    verifiedAt TEXT DEFAULT NULL,
    note TEXT DEFAULT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (opportunityId) REFERENCES opportunities(id),
    FOREIGN KEY (userId) REFERENCES users(id),
    UNIQUE(opportunityId, userId, occurrenceDate)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    postId TEXT,
    read INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    postId TEXT NOT NULL,
    postTitle TEXT NOT NULL,
    reporterId TEXT NOT NULL,
    reporterName TEXT NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    userId TEXT,
    username TEXT,
    rating INTEGER NOT NULL,
    message TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appeals (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS onboarding_links (
    slug TEXT PRIMARY KEY,
    orgName TEXT NOT NULL,
    category TEXT,
    createdAt TEXT NOT NULL,
    claimedAt TEXT DEFAULT NULL,
    claimedBy TEXT DEFAULT NULL
  );

  -- One live session per event occurrence. This — not the posted date — is
  -- what gates check-in, because a posted date is a naive local string and
  -- the server's clock may be in another timezone entirely. startedAt and
  -- autoStopAt are real instants, so the gate can't drift.
  --
  -- Status is derived, never stored: autoStartAt in the past means running
  -- even if nobody pressed the button, autoStopAt in the past means stopped.
  -- That's what lets auto-start and auto-stop work with no cron job.
  CREATE TABLE IF NOT EXISTS event_sessions (
    id TEXT PRIMARY KEY,
    opportunityId TEXT NOT NULL,
    occurrenceDate TEXT NOT NULL,
    autoStartAt TEXT DEFAULT NULL,
    startedAt TEXT DEFAULT NULL,
    autoStopAt TEXT NOT NULL,
    stoppedAt TEXT DEFAULT NULL,
    startedBy TEXT DEFAULT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (opportunityId) REFERENCES opportunities(id),
    UNIQUE(opportunityId, occurrenceDate)
  );

  -- Each pause is an interval, not a running total, because a volunteer who
  -- arrives after the break must not have that break deducted. Hours
  -- subtract only the overlap between a pause and that person's own
  -- checked-in window. resumedAt NULL means still paused.
  CREATE TABLE IF NOT EXISTS session_pauses (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    pausedAt TEXT NOT NULL,
    resumedAt TEXT DEFAULT NULL,
    FOREIGN KEY (sessionId) REFERENCES event_sessions(id)
  );

  -- One row per scan-in/scan-out pair. Deliberately NOT unique per person
  -- per occurrence: a volunteer can leave and come back as many times as
  -- they like while the org's session runs, and their hours are the sum of
  -- the segments. The attendance row above stays the single summary
  -- everything else reads (roster, CSV export, profile total).
  -- A volunteer asking for a milestone to be issued as a formal certificate.
  -- Reaching a tier is automatic and already shows on their profile; this is
  -- the separate step of asking for something with LocalLink's name on it,
  -- which an admin reviews.
  --
  -- UNIQUE(userId, hostId, tier) is doing real work: one application per
  -- milestone per organization, so the queue can't be spammed and the same
  -- certificate can't be issued twice.
  CREATE TABLE IF NOT EXISTS certificate_applications (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    hostId TEXT NOT NULL,
    tier INTEGER NOT NULL,
    hoursAtApply REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    note TEXT DEFAULT NULL,
    decidedBy TEXT DEFAULT NULL,
    decidedAt TEXT DEFAULT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id),
    FOREIGN KEY (hostId) REFERENCES users(id),
    UNIQUE(userId, hostId, tier)
  );

  CREATE TABLE IF NOT EXISTS attendance_segments (
    id TEXT PRIMARY KEY,
    opportunityId TEXT NOT NULL,
    userId TEXT NOT NULL,
    occurrenceDate TEXT NOT NULL,
    checkInAt TEXT NOT NULL,
    checkOutAt TEXT DEFAULT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (opportunityId) REFERENCES opportunities(id),
    FOREIGN KEY (userId) REFERENCES users(id)
  );

`);

// Migrate: add committedAt to signups. NULL = interested only (the soft
// bookmark that already existed), a timestamp = committed. The org's roster
// reads committed rows only, so "Interested" keeps working exactly as it
// did and nothing about the existing board changes.
try {
  db.prepare('SELECT committedAt FROM signups LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE signups ADD COLUMN committedAt TEXT DEFAULT NULL');
}

// Migrate: add hoursLocked to attendance. Set only when a host deliberately
// sets a number or revokes a credit — NOT by "mark as came", which is a
// stand-in for someone who couldn't scan. Without the distinction, marking
// someone present would permanently freeze their row, so if they later
// actually scanned, their real hours could never land.
try {
  db.prepare('SELECT hoursLocked FROM attendance LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE attendance ADD COLUMN hoursLocked INTEGER DEFAULT 0');
}

// Migrate: optional per-session check-in code. The QR encodes a plain URL
// and carries no secret, so anyone sent the link can scan from anywhere
// during the event. A short code shown only on the organizer's screen means
// you have to actually be in the room — while a printed QR still works,
// which a rotating code would have broken.
try {
  db.prepare('SELECT checkinPin FROM event_sessions LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE event_sessions ADD COLUMN checkinPin TEXT DEFAULT NULL');
}

// Migrate: certificate review became two stages — the organization confirms,
// then an admin issues. Applications filed under the single-stage flow carry
// status 'pending', which now matches neither queue: invisible to the
// organization AND the admin, while the volunteer sees an Apply button as
// though they never asked. Move them to the front of the new pipeline.
// Idempotent, safe on every boot.
db.exec("UPDATE certificate_applications SET status = 'pending_org' WHERE status = 'pending'");

// Migrate: birth year, for working out whether a volunteer is a minor.
//
// INTERNAL ONLY — no endpoint returns it. What leaves the server is the
// derived "under 18 / 18+", and only to organizations the volunteer has
// committed to, who have a real need: consent forms, supervision, tasks a
// minor legally can't do.
//
// The year rather than a bracket fixed at signup, because a bracket never
// updates — someone who joins at 17 would be labelled a minor at 25, which
// is precisely wrong for the safety purpose this exists to serve. A year is
// 365x less precise than a date of birth and never appears in a response.
//
// NULL for everyone who registered before this, and for organizations,
// which are not people.
try {
  db.prepare('SELECT birthYear FROM users LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE users ADD COLUMN birthYear INTEGER DEFAULT NULL');
}

// Migrate: events an organization marks as 18+, for work a minor legally or
// practically can't do — power tools, late shifts, some client-facing roles.
try {
  db.prepare('SELECT adultsOnly FROM opportunities LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE opportunities ADD COLUMN adultsOnly INTEGER DEFAULT 0');
}

// Migrate: opt-in share link for a volunteer's verified record. NULL means
// the profile is private, which is the default and stays the default —
// this user base skews young, and a browsable directory of who volunteers
// where, on which recurring day, is a safety problem rather than a feature.
// A token exists only once someone deliberately creates one, and revoking
// clears it so any copied link dies with it.
try {
  db.prepare('SELECT profileShareToken FROM users LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE users ADD COLUMN profileShareToken TEXT DEFAULT NULL');
}

// Migrate: add isAdmin column if it doesn't exist yet
try {
  db.prepare('SELECT isAdmin FROM users LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE users ADD COLUMN isAdmin INTEGER DEFAULT 0');
}

// Migrate: add emailVerified column if it doesn't exist yet
try {
  db.prepare('SELECT emailVerified FROM users LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE users ADD COLUMN emailVerified INTEGER DEFAULT 0');
}

// Migrate: add tags column to opportunities if it doesn't exist yet
try {
  db.prepare('SELECT tags FROM opportunities LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE opportunities ADD COLUMN tags TEXT DEFAULT '[]'");
}

// Migrate: add spotsType column to opportunities if it doesn't exist yet
try {
  db.prepare('SELECT spotsType FROM opportunities LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE opportunities ADD COLUMN spotsType TEXT DEFAULT 'limited'");
}

// Migrate: add accountType column to users if it doesn't exist yet
try {
  db.prepare('SELECT accountType FROM users LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE users ADD COLUMN accountType TEXT DEFAULT 'volunteer'");
}

// Migrate: add banned column to users if it doesn't exist yet
try {
  db.prepare('SELECT banned FROM users LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0");
}

// Migrate: add notifyOnInterest column to users if it doesn't exist yet
try {
  db.prepare('SELECT notifyOnInterest FROM users LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE users ADD COLUMN notifyOnInterest INTEGER DEFAULT 0");
}

// One-time backfill: notifyOnInterest shipped defaulting to 0 with no UI
// toggle, so in-app interest notifications never fired for anyone. New
// registrations now insert 1 explicitly; flip existing rows too. Idempotent,
// safe to run every boot. Remove once a user-facing toggle ships.
db.exec("UPDATE users SET notifyOnInterest = 1 WHERE notifyOnInterest = 0 OR notifyOnInterest IS NULL");

// Migrate: add notifyOnReopen column to users if it doesn't exist yet (default 1 = opted in)
try {
  db.prepare('SELECT notifyOnReopen FROM users LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE users ADD COLUMN notifyOnReopen INTEGER DEFAULT 1");
}

// Migrate: add profileImage column to users if it doesn't exist yet
try {
  db.prepare('SELECT profileImage FROM users LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE users ADD COLUMN profileImage TEXT DEFAULT NULL");
}

// Migrate: add isAvailable column to opportunities if it doesn't exist yet
try {
  db.prepare('SELECT isAvailable FROM opportunities LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE opportunities ADD COLUMN isAvailable INTEGER DEFAULT 1");
}

// Migrate: add isRecurring column to opportunities if it doesn't exist yet
try {
  db.prepare('SELECT isRecurring FROM opportunities LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE opportunities ADD COLUMN isRecurring INTEGER DEFAULT 0');
}

// Migrate: add recurringDay column to opportunities if it doesn't exist yet (0=Sun … 6=Sat)
try {
  db.prepare('SELECT recurringDay FROM opportunities LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE opportunities ADD COLUMN recurringDay INTEGER DEFAULT NULL');
}

// Migrate: add recurringTime column to opportunities if it doesn't exist yet (e.g. "12:00")
try {
  db.prepare('SELECT recurringTime FROM opportunities LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE opportunities ADD COLUMN recurringTime TEXT DEFAULT NULL");
}

// Migrate: add pinnedSize column to opportunities if it doesn't exist yet
// NULL = auto (driven by popularity); 'small' | 'medium' | 'large' = admin override
try {
  db.prepare('SELECT pinnedSize FROM opportunities LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE opportunities ADD COLUMN pinnedSize TEXT DEFAULT NULL");
}

// Migrate: add cardObjectPosition — CSS object-position for the board card image
try {
  db.prepare('SELECT cardObjectPosition FROM opportunities LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE opportunities ADD COLUMN cardObjectPosition TEXT DEFAULT NULL");
}

// Migrate: add modalObjectPosition — CSS object-position for the post detail banner
try {
  db.prepare('SELECT modalObjectPosition FROM opportunities LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE opportunities ADD COLUMN modalObjectPosition TEXT DEFAULT NULL");
}

// Migrate: add status column to opportunities (pending = awaiting admin approval, approved = visible, denied = rejected)
// Existing posts default to 'approved' so nothing breaks.
try {
  db.prepare('SELECT status FROM opportunities LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE opportunities ADD COLUMN status TEXT DEFAULT 'approved'");
}

// Migrate: add orgDescription column to users
try {
  db.prepare('SELECT orgDescription FROM users LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE users ADD COLUMN orgDescription TEXT DEFAULT NULL");
}

// Migrate: add orgWebsite column to users
try {
  db.prepare('SELECT orgWebsite FROM users LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE users ADD COLUMN orgWebsite TEXT DEFAULT NULL");
}

// Migrate: add orgEmail column to users
try {
  db.prepare('SELECT orgEmail FROM users LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE users ADD COLUMN orgEmail TEXT DEFAULT NULL");
}

// Migrate: add orgPhone column to users
try {
  db.prepare('SELECT orgPhone FROM users LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE users ADD COLUMN orgPhone TEXT DEFAULT NULL");
}

// Migrate: add steps column to opportunities (JSON array of volunteer step strings)
try {
  db.prepare('SELECT steps FROM opportunities LIMIT 1').get();
} catch {
  db.exec("ALTER TABLE opportunities ADD COLUMN steps TEXT DEFAULT '[]'");
}

// Migrate: add emailReminders to users (1 = opted in, 0 = unsubscribed from reminders)
try {
  db.prepare('SELECT emailReminders FROM users LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE users ADD COLUMN emailReminders INTEGER DEFAULT 1');
}

// Migrate: add hasSeenWelcome to users (1 = has seen it, existing users default 1)
try {
  db.prepare('SELECT hasSeenWelcome FROM users LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE users ADD COLUMN hasSeenWelcome INTEGER DEFAULT 1');
}

// Migrate: add unsubToken to users (UUID used in unsubscribe link)
try {
  db.prepare('SELECT unsubToken FROM users LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE users ADD COLUMN unsubToken TEXT DEFAULT NULL');
}

// Migrate: add isFeatured to opportunities
try {
  db.prepare('SELECT isFeatured FROM opportunities LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE opportunities ADD COLUMN isFeatured INTEGER DEFAULT 0');
}

// Migrate: add verified column to users (org verification badge)
try {
  db.prepare('SELECT verified FROM users LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE users ADD COLUMN verified INTEGER DEFAULT 0');
}

// Migrate: add lastReminderAt to signups (tracks when last 24h reminder was sent)
try {
  db.prepare('SELECT lastReminderAt FROM signups LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE signups ADD COLUMN lastReminderAt TEXT DEFAULT NULL');
}

// Migrate: add town to opportunities (fixed Somerset-area list; null = not set yet)
try {
  db.prepare('SELECT town FROM opportunities LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE opportunities ADD COLUMN town TEXT DEFAULT NULL');
}

// Migrate: add externalSignupUrl to opportunities (org's own registration page, if any)
try {
  db.prepare('SELECT externalSignupUrl FROM opportunities LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE opportunities ADD COLUMN externalSignupUrl TEXT DEFAULT NULL');
}

// One-time backfill: tag pre-field posts with a town ONLY when the location or
// title plainly contains a listed town's name — anything ambiguous stays null
// for a human to set via the edit form. Idempotent (guarded by town IS NULL);
// posts in towns not on the list are deliberately left alone. Remove once the
// July 2026 backfill has shipped and real posts are tagged.
const TOWN_BACKFILL_ALIASES: [string, string][] = [
  ['montgomery', 'Montgomery/Skillman'], ['skillman', 'Montgomery/Skillman'],
  ['hillsborough', 'Hillsborough'], ['princeton', 'Princeton'],
  ['bridgewater', 'Bridgewater'], ['somerville', 'Somerville'],
  ['franklin township', 'Franklin Township'], ['manville', 'Manville'],
  ['raritan', 'Raritan'], ['belle mead', 'Belle Mead/Rocky Hill'],
  ['rocky hill', 'Belle Mead/Rocky Hill'], ['flemington', 'Flemington'],
];
for (const [needle, canonicalTown] of TOWN_BACKFILL_ALIASES) {
  db.prepare(
    'UPDATE opportunities SET town = ? WHERE town IS NULL AND (lower(location) LIKE ? OR lower(title) LIKE ?)'
  ).run(canonicalTown, `%${needle}%`, `%${needle}%`);
}

// Auto-grant admin and auto-verify the designated admin email
if (!process.env.ADMIN_EMAIL) {
  console.warn(
    '[SECURITY WARNING] ADMIN_EMAIL environment variable is not set. ' +
    'Falling back to hardcoded default — set ADMIN_EMAIL in your .env / deployment config.'
  );
}
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'linklocal2@gmail.com';
db.prepare('UPDATE users SET isAdmin = 1, emailVerified = 1 WHERE email = ?').run(ADMIN_EMAIL);

// Seed data if tables are empty
const oppCount = db.prepare('SELECT COUNT(*) as count FROM opportunities').get() as any;
const alreadySeeded = db.prepare("SELECT id FROM opportunities WHERE id = '1'").get();
if (!alreadySeeded && oppCount.count === 0) {
  const insertOpp = db.prepare(`
    INSERT INTO opportunities (id, title, description, category, location, date, duration, spots, spotsRemaining, image, hostId, hostName, popularity, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Helper: returns an ISO datetime string N days from now at a given time
  const futureDate = (daysFromNow: number, time: string) => {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return `${d.toISOString().slice(0, 10)}T${time}`;
  };

  const seedOpps = [
    { id: '1', title: 'Community Clean-up', description: 'Join us for a community clean-up event at Lake Accotink Park. Help make our neighborhood cleaner and greener!', category: 'volunteer', location: 'Lake Accotink Park, Montgomery', date: futureDate(3, '09:00'), duration: 3, spots: 50, spotsRemaining: 12, image: 'https://images.unsplash.com/photo-1618477388954-7852f32655ec?w=800', hostId: 'seed1', hostName: 'EcoWarriors', popularity: 38 },
    { id: '2', title: 'Math Tutoring Session', description: 'Free tutoring for middle school students. Help students excel in mathematics!', category: 'education', location: 'Montgomery Public Library', date: futureDate(6, '14:00'), duration: 2, spots: 20, spotsRemaining: 15, image: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800', hostId: 'seed2', hostName: 'MathGenius', popularity: 5 },
    { id: '3', title: 'Youth Soccer Tournament', description: 'Coach and mentor young athletes at our annual youth soccer tournament!', category: 'fitness', location: 'Sports Complex', date: futureDate(8, '10:00'), duration: 6, spots: 30, spotsRemaining: 8, image: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800', hostId: 'seed3', hostName: 'SportsClub', popularity: 22 },
    { id: '4', title: 'Food Bank Packaging', description: 'Help package and distribute food to families in need in our community.', category: 'community', location: '123 Charity Street', date: futureDate(5, '08:00'), duration: 4, spots: 100, spotsRemaining: 75, image: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?w=800', hostId: 'seed4', hostName: 'FoodForAll', popularity: 25 },
    { id: '5', title: 'Environmental Workshop', description: 'Learn about climate change and sustainable practices in this interactive workshop.', category: 'environment', location: 'Green Center', date: futureDate(10, '13:00'), duration: 3, spots: 40, spotsRemaining: 22, image: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=800', hostId: 'seed5', hostName: 'GreenFuture', popularity: 18 },
    { id: '6', title: 'Community Garden Setup', description: 'Help build and plant a new community garden in downtown Montgomery.', category: 'environment', location: 'Downtown Plaza', date: futureDate(14, '09:00'), duration: 3, spots: 25, spotsRemaining: 10, image: 'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=800', hostId: 'seed6', hostName: 'GreenThumb', popularity: 15 },
  ];

  const insertMany = db.transaction((opps: typeof seedOpps) => {
    for (const o of opps) {
      insertOpp.run(o.id, o.title, o.description, o.category, o.location, o.date, o.duration, o.spots, o.spotsRemaining, o.image, o.hostId, o.hostName, o.popularity, new Date().toISOString());
    }
  });
  insertMany(seedOpps);
}

export default db;
