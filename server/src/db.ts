// SQLite via node:sqlite (built into Node 22+). The schema maps 1:1 to
// Postgres for production. Nothing here stores message content: there is
// no messages table by design.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id               TEXT PRIMARY KEY,
  username         TEXT NOT NULL UNIQUE,          -- canonical lowercase, one per account
  created_at       INTEGER NOT NULL,
  ed_pub           TEXT NOT NULL UNIQUE,          -- identity signing key (login)
  x_pub            TEXT NOT NULL,                 -- identity DH key
  spk_pub          TEXT,
  spk_id           INTEGER,
  spk_sig          TEXT,
  display_name     TEXT NOT NULL DEFAULT '',
  bio              TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'online',
  custom_status    TEXT NOT NULL DEFAULT '',
  theme_json       TEXT NOT NULL DEFAULT '{}',
  privacy_json     TEXT NOT NULL DEFAULT '{}',
  avatar           TEXT,
  banner           TEXT,
  background       TEXT,
  roles_json       TEXT NOT NULL DEFAULT '[]',    -- staff, developer, founder
  badges_json      TEXT NOT NULL DEFAULT '[]',    -- granted badges only
  username_changes INTEGER NOT NULL DEFAULT 0,
  last_username_change INTEGER,
  flagged_network  INTEGER NOT NULL DEFAULT 0,    -- datacenter / VPN at signup
  active_days      INTEGER NOT NULL DEFAULT 1,
  last_active_day  TEXT,
  banned           INTEGER NOT NULL DEFAULT 0,
  invited_by       TEXT
);

-- Old usernames stay locked after a change so nobody can grab them.
CREATE TABLE IF NOT EXISTS username_locks (
  name       TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  until      INTEGER NOT NULL
);

-- Short-name claims: 3–4 chars go on a visible 24h hold, 1–2 need staff.
CREATE TABLE IF NOT EXISTS claim_requests (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  tier         TEXT NOT NULL,
  status       TEXT NOT NULL,      -- holding | pending_staff | approved | denied | cancelled | finalized
  created_at   INTEGER NOT NULL,
  available_at INTEGER,
  decided_by   TEXT,
  ip_hash      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS claim_active_name ON claim_requests(name) WHERE status IN ('holding','pending_staff');
CREATE UNIQUE INDEX IF NOT EXISTS claim_active_account ON claim_requests(account_id) WHERE status IN ('holding','pending_staff');

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  created_by TEXT,
  used_by    TEXT,
  created_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Reports are about public profiles only (name, avatar, bio). Never messages.
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open'
);

-- Hashed device / IP fingerprints used only for rate limiting and anti-hoarding.
CREATE TABLE IF NOT EXISTS signup_fingerprints (
  kind       TEXT NOT NULL,     -- ip | device
  hash       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fp_lookup ON signup_fingerprints(kind, hash, created_at);
`);

// Staff audit log: every moderation action, who did it, and why.
db.exec(`
CREATE TABLE IF NOT EXISTS staff_audit (
  id         TEXT PRIMARY KEY,
  at         INTEGER NOT NULL,
  staff_id   TEXT NOT NULL,
  target_id  TEXT,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_target ON staff_audit(target_id, at);
`);

// Credits ledger + username marketplace listings.
db.exec(`
CREATE TABLE IF NOT EXISTS credit_ledger (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_by_account ON credit_ledger(account_id, at);
CREATE TABLE IF NOT EXISTS listings (
  id        TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  status    TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  ends_at   INTEGER
);
CREATE INDEX IF NOT EXISTS listings_status ON listings(status);
`);

// Additive migrations for databases created by earlier versions.
const ACCOUNT_COLUMNS: [string, string][] = [
  ['hidden_badges_json', "TEXT NOT NULL DEFAULT '[]'"],
  ['house', 'TEXT'],
  ['supporter_since', 'INTEGER'],
  ['booster_since', 'INTEGER'],
  ['previous_username', 'TEXT'],
  ['original_username', 'TEXT'],
  ['banned_until', 'INTEGER'],
  ['ban_reason', 'TEXT'],
  ['muted_until', 'INTEGER'],
  ['mute_reason', 'TEXT'],
  ['frozen_until', 'INTEGER'],
  ['freeze_reason', 'TEXT'],
  ['discovery_locked', 'INTEGER NOT NULL DEFAULT 0'],
  ['notices_json', "TEXT NOT NULL DEFAULT '[]'"],
  ['credits', 'INTEGER NOT NULL DEFAULT 1000'],
  ['owned_cosmetics_json', "TEXT NOT NULL DEFAULT '[]'"],
  ['frame', 'TEXT'],
  ['effect', 'TEXT'],
  ['titles_json', "TEXT NOT NULL DEFAULT '[]'"],
  ['last_bonus_day', 'TEXT'],
  ['pronouns', "TEXT NOT NULL DEFAULT ''"],
  ['links_json', "TEXT NOT NULL DEFAULT '[]'"],
  ['name_fx', 'TEXT'],
  ['accessory', 'TEXT'],
  ['lockdown_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['market_banned', 'INTEGER NOT NULL DEFAULT 0'],
];
{
  const have = new Set((db.prepare('PRAGMA table_info(accounts)').all() as { name: string }[]).map((c) => c.name));
  for (const [col, type] of ACCOUNT_COLUMNS) if (!have.has(col)) db.exec(`ALTER TABLE accounts ADD COLUMN ${col} ${type}`);
  // Accounts from before original_username existed: the first name they ever held is the
  // earliest previous name (every rename kept the first one), or the current one if never renamed.
  db.exec('UPDATE accounts SET original_username = COALESCE(previous_username, username) WHERE original_username IS NULL');
}

{
  // sessions: a public id, a coarse device label ("Firefox on Linux") and last use. No IPs.
  const have = new Set((db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name));
  if (!have.has('sid')) db.exec('ALTER TABLE sessions ADD COLUMN sid TEXT');
  if (!have.has('label')) db.exec("ALTER TABLE sessions ADD COLUMN label TEXT NOT NULL DEFAULT ''");
  if (!have.has('last_seen')) db.exec('ALTER TABLE sessions ADD COLUMN last_seen INTEGER');
}

// Site-wide switches and staff-written updates.
db.exec(`
CREATE TABLE IF NOT EXISTS platform (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS updates (
  id    TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body  TEXT NOT NULL,
  tag   TEXT NOT NULL,
  at    INTEGER NOT NULL,
  by_id TEXT
);
`);

export type Row = Record<string, any>;

export function one<T = Row>(sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function all<T = Row>(sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}
let depth = 0;
/** Transaction; nested calls join the outer one (savepoints for partial rollback). */
export function tx<T>(fn: () => T): T {
  const sp = `sp${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const r = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}
