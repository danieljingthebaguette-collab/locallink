import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

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

`);

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

// Migrate: add the volunteer onboarding questionnaire fields to users.
// Six flat nullable columns, matching the org-profile precedent (orgDescription/
// orgWebsite/orgEmail/orgPhone) rather than a separate table -- same 1:1
// relationship, same "meaningless for the other account type" shape.
// onboardingCompletedAt is the only field that gates anything: NULL is the
// signal to prompt, on every existing row and every new one, until they
// answer (or every field could be skipped individually and it would still
// count as done -- completion is "they saw the form and submitted it").
try {
  db.prepare('SELECT onboardingCompletedAt FROM users LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE users ADD COLUMN onboardingHoursSoFar REAL DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN onboardingInterests TEXT DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN onboardingMajors TEXT DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN onboardingGoalHours REAL DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN onboardingGoalEvents INTEGER DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN onboardingCompletedAt TEXT DEFAULT NULL');
}

// Migrate: two more questionnaire answers, added after the six above already
// shipped -- a separate idempotent block rather than folding into the one
// above, since that one's guard column (onboardingCompletedAt) already
// exists on every database that predates this change.
try {
  db.prepare('SELECT onboardingTowns FROM users LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE users ADD COLUMN onboardingTowns TEXT DEFAULT NULL');
  db.exec('ALTER TABLE users ADD COLUMN onboardingAvailability TEXT DEFAULT NULL');
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

// Helper: returns an ISO datetime string N days from now at a given time
const futureDate = (daysFromNow: number, time: string) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.toISOString().slice(0, 10)}T${time}`;
};

// What an organizer would actually write under "How to Participate". Kept
// beside the posts rather than inline in each row, so the backfill further
// down can reuse them for databases seeded before posts carried steps.
const SEED_STEPS: Record<string, string[]> = {
  '1': ['Wear closed-toe shoes and clothes you don\'t mind getting muddy.',
        'Meet at the main car park by 8:45am — we start on time.',
        'Gloves, bags and litter-pickers are provided; bring your own water.'],
  '2': ['Reply to the confirmation email so we know which subject to pair you with.',
        'Arrive 15 minutes early to sign in at the front desk.',
        'Bring a laptop or tablet if you have one — a few students share ours.'],
  '3': ['Let us know which age group you\'d like to help coach.',
        'Collect your volunteer shirt from the clubhouse on arrival.',
        'Stay for the wrap-up at the end so we can hand back equipment together.'],
  '4': ['Sign in at the loading bay entrance, not the main door.',
        'Wear closed-toe shoes — this is a warehouse floor.',
        'Shifts run in two-hour blocks; tell the coordinator if you need to leave early.'],
  '5': ['Bring a notebook — the second half is hands-on planning.',
        'Let us know in advance if you need any accessibility arrangements.'],
  '6': ['Bring gardening gloves if you own a pair; we have spares otherwise.',
        'Park on Elm Street — the plaza car park is closed for the build.',
        'Come for as long as you can, even if it\'s only an hour.'],
};

// Declared out here so the town and step backfills further down can reuse the
// same values rather than repeating them.
const SEED_OPPS = [
    { id: '1', title: 'Community Clean-up', description: 'Join us for a community clean-up event at Lake Accotink Park. Help make our neighborhood cleaner and greener!', category: 'volunteer', location: 'Lake Accotink Park, Montgomery', town: 'Montgomery/Skillman', date: futureDate(3, '09:00'), duration: 3, spots: 50, spotsRemaining: 12, image: 'https://images.unsplash.com/photo-1618477388954-7852f32655ec?w=800', hostId: 'seed1', hostName: 'EcoWarriors', popularity: 38 },
    { id: '2', title: 'Math Tutoring Session', description: 'Free tutoring for middle school students. Help students excel in mathematics!', category: 'education', location: 'Montgomery Public Library', town: 'Montgomery/Skillman', date: futureDate(6, '14:00'), duration: 2, spots: 20, spotsRemaining: 15, image: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800', hostId: 'seed2', hostName: 'MathGenius', popularity: 5 },
    { id: '3', title: 'Youth Soccer Tournament', description: 'Coach and mentor young athletes at our annual youth soccer tournament!', category: 'fitness', location: 'Sports Complex', town: 'Bridgewater', date: futureDate(8, '10:00'), duration: 6, spots: 30, spotsRemaining: 8, image: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800', hostId: 'seed3', hostName: 'SportsClub', popularity: 22 },
    { id: '4', title: 'Food Bank Packaging', description: 'Help package and distribute food to families in need in our community.', category: 'community', location: '123 Charity Street', town: 'Somerville', date: futureDate(5, '08:00'), duration: 4, spots: 100, spotsRemaining: 75, image: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?w=800', hostId: 'seed4', hostName: 'FoodForAll', popularity: 25 },
    { id: '5', title: 'Environmental Workshop', description: 'Learn about climate change and sustainable practices in this interactive workshop.', category: 'environment', location: 'Green Center', town: 'Princeton', date: futureDate(10, '13:00'), duration: 3, spots: 40, spotsRemaining: 22, image: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=800', hostId: 'seed5', hostName: 'GreenFuture', popularity: 18 },
    { id: '6', title: 'Community Garden Setup', description: 'Help build and plant a new community garden in downtown Montgomery.', category: 'environment', location: 'Downtown Plaza', town: 'Montgomery/Skillman', date: futureDate(14, '09:00'), duration: 3, spots: 25, spotsRemaining: 10, image: 'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=800', hostId: 'seed6', hostName: 'GreenThumb', popularity: 15 },
  ];

// Seed data if tables are empty
const oppCount = db.prepare('SELECT COUNT(*) as count FROM opportunities').get() as any;
const alreadySeeded = db.prepare("SELECT id FROM opportunities WHERE id = '1'").get();
// Opt-in, and deliberately so. The existing "only when the table is empty"
// guard is a guess about intent read off the data, and it guesses wrong on a
// brand-new production database — which is empty for exactly as long as it
// takes the first real organization to post. That would drop six invented
// orgs with @example.com addresses onto a live site alongside real ones.
// The live site is not a place to find out. Set SEED_SAMPLE_DATA=1 locally
// when you want a populated board to develop against; production never does.
const wantsSampleData = process.env.SEED_SAMPLE_DATA === '1';
if (wantsSampleData && !alreadySeeded && oppCount.count === 0) {
  const insertOpp = db.prepare(`
    INSERT INTO opportunities (id, title, description, category, location, town, date, duration, spots, spotsRemaining, image, hostId, hostName, popularity, steps, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction(() => {
    const now = new Date().toISOString();
    for (const o of SEED_OPPS) {
      insertOpp.run(o.id, o.title, o.description, o.category, o.location, o.town, o.date, o.duration, o.spots, o.spotsRemaining, o.image, o.hostId, o.hostName, o.popularity, JSON.stringify(SEED_STEPS[o.id] ?? []), now);
    }
  });
  insertMany();
}

// Same story as the towns: the sample posts were seeded before they carried
// steps, so an existing database has them empty and the modal's "See more"
// never appears. Only fills rows that are still empty -- never overwrites
// steps an organizer has since written.
const setSeedSteps = db.prepare(
  "UPDATE opportunities SET steps = ? WHERE id = ? AND hostId = ? AND (steps IS NULL OR steps = '' OR steps = '[]')"
);
db.transaction(() => {
  for (const o of SEED_OPPS) {
    const steps = SEED_STEPS[o.id];
    if (steps) setSeedSteps.run(JSON.stringify(steps), o.id, o.hostId);
  }
})();

// The sample posts predate the town column, so a database seeded earlier has
// four of them sitting with no town -- which the board's town filter drops.
// The generic location-matching backfill above can't place them ("Sports
// Complex", "Green Center"), so set them from the same list the seed uses.
const setSeedTown = db.prepare(
  "UPDATE opportunities SET town = ? WHERE id = ? AND hostId = ? AND (town IS NULL OR town = '')"
);
db.transaction(() => {
  for (const o of SEED_OPPS) setSeedTown.run(o.town, o.id, o.hostId);
})();

// The organizations hosting the sample posts above. Without these rows the
// board asks /api/users/seedN/profile for every card and gets a 404, so host
// avatars never load and the host-name link to /org/:id dead-ends.
//
// Runs outside the seeding block, and only for a host some opportunity
// actually points at, so it also repairs databases seeded before these rows
// existed while staying a no-op on any database that has no sample posts.
//
// Addresses use the reserved .example TLD so nothing here can reach a real
// inbox, and notifyOnInterest is off so signing up to a sample post doesn't
// queue mail to a domain that cannot receive it. The password column holds a
// sentinel rather than a hash -- bcryptjs returns false for anything that is
// not a valid hash, so these accounts can never be logged into.
const SEED_ORGS = [
  { id: 'seed1', name: 'EcoWarriors', desc: 'Neighbourhood clean-ups and conservation days across Montgomery and Skillman.' },
  { id: 'seed2', name: 'MathGenius',  desc: 'Free maths tutoring for middle and high school students.' },
  { id: 'seed3', name: 'SportsClub',  desc: 'Youth sports coaching, tournaments and open recreation nights.' },
  { id: 'seed4', name: 'FoodForAll',  desc: 'Packing and distributing food to families across the county.' },
  { id: 'seed5', name: 'GreenFuture', desc: 'Workshops on climate, sustainability and practical green living.' },
  { id: 'seed6', name: 'GreenThumb',  desc: 'Building and tending community gardens in the downtown area.' },
];

const seedOrgIsHosting = db.prepare('SELECT 1 FROM opportunities WHERE hostId = ? LIMIT 1');
const seedOrgExists = db.prepare('SELECT 1 FROM users WHERE id = ? LIMIT 1');
const insertSeedOrg = db.prepare(`
  INSERT OR IGNORE INTO users (id, username, email, password, isAdmin, emailVerified, accountType,
                               orgDescription, orgEmail, orgWebsite, verified, notifyOnInterest,
                               unsubToken, createdAt)
  VALUES (?, ?, ?, 'NO_LOGIN', 0, 1, 'organization', ?, ?, ?, 1, 0, ?, ?)
`);

db.transaction(() => {
  const now = new Date().toISOString();
  for (const o of SEED_ORGS) {
    if (!seedOrgIsHosting.get(o.id) || seedOrgExists.get(o.id)) continue;
    const handle = o.name.toLowerCase();
    insertSeedOrg.run(
      o.id, o.name, `${handle}@example.com`, o.desc,
      `contact@${handle}.example`, `https://${handle}.example`,
      randomUUID(), now
    );
  }
})();

export default db;
