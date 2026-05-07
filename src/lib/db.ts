import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// Singleton — better-sqlite3 is synchronous and a single connection is fine for this app.
// In dev, Next.js hot-reloads can re-execute this module, so we cache on globalThis.
declare global {
  // eslint-disable-next-line no-var
  var __urlShortenerDb: Database.Database | undefined;
}

function resolveDatabasePath(): string {
  const raw = process.env.DATABASE_PATH ?? "./data/urls.db";
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function openDatabase(): Database.Database {
  const dbPath = resolveDatabasePath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  // WAL = better concurrency for redirects + admin reads happening in parallel.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS urls (
      code         TEXT PRIMARY KEY,
      original_url TEXT    NOT NULL,
      clicks       INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS urls_created_at_idx ON urls(created_at DESC);
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!globalThis.__urlShortenerDb) {
    globalThis.__urlShortenerDb = openDatabase();
  }
  return globalThis.__urlShortenerDb;
}

export type UrlRow = {
  code: string;
  original_url: string;
  clicks: number;
  created_at: number;
};
