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

`);

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

// Auto-grant admin and auto-verify the designated admin email
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

  const seedOpps = [
    { id: '1', title: 'Community Clean-up', description: 'Join us for a community clean-up event at Lake Accotink Park. Help make our neighborhood cleaner and greener!', category: 'volunteer', location: 'Lake Accotink Park, Montgomery', date: '2026-02-15T09:00', duration: 3, spots: 50, spotsRemaining: 12, image: 'https://images.unsplash.com/photo-1618477388954-7852f32655ec?w=800', hostId: 'seed1', hostName: 'EcoWarriors', popularity: 38 },
    { id: '2', title: 'Math Tutoring Session', description: 'Free tutoring for middle school students. Help students excel in mathematics!', category: 'education', location: 'Montgomery Public Library', date: '2026-02-18T14:00', duration: 2, spots: 20, spotsRemaining: 15, image: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800', hostId: 'seed2', hostName: 'MathGenius', popularity: 5 },
    { id: '3', title: 'Youth Soccer Tournament', description: 'Coach and mentor young athletes at our annual youth soccer tournament!', category: 'sports', location: 'Sports Complex', date: '2026-02-20T10:00', duration: 6, spots: 30, spotsRemaining: 8, image: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800', hostId: 'seed3', hostName: 'SportsClub', popularity: 22 },
    { id: '4', title: 'Food Bank Packaging', description: 'Help package and distribute food to families in need in our community.', category: 'community', location: '123 Charity Street', date: '2026-02-17T08:00', duration: 4, spots: 100, spotsRemaining: 75, image: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?w=800', hostId: 'seed4', hostName: 'FoodForAll', popularity: 25 },
    { id: '5', title: 'Environmental Workshop', description: 'Learn about climate change and sustainable practices in this interactive workshop.', category: 'environment', location: 'Green Center', date: '2026-02-22T13:00', duration: 3, spots: 40, spotsRemaining: 22, image: 'https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=800', hostId: 'seed5', hostName: 'GreenFuture', popularity: 18 },
    { id: '6', title: 'Community Garden Setup', description: 'Help build and plant a new community garden in downtown Montgomery.', category: 'environment', location: 'Downtown Plaza', date: '2026-02-25T09:00', duration: 3, spots: 25, spotsRemaining: 10, image: 'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=800', hostId: 'seed6', hostName: 'GreenThumb', popularity: 15 },
  ];

  const insertMany = db.transaction((opps: typeof seedOpps) => {
    for (const o of opps) {
      insertOpp.run(o.id, o.title, o.description, o.category, o.location, o.date, o.duration, o.spots, o.spotsRemaining, o.image, o.hostId, o.hostName, o.popularity, new Date().toISOString());
    }
  });
  insertMany(seedOpps);
}

export default db;
