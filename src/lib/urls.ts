import { customAlphabet } from "nanoid";
import { getDb, type UrlRow } from "./db";

// Base62 alphabet — URL-safe, no ambiguous characters in most fonts.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CODE_LENGTH = 7;
const generateCode = customAlphabet(ALPHABET, CODE_LENGTH);

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

export function isValidUrl(input: string): boolean {
  if (!URL_PATTERN.test(input)) return false;
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

export function createShortUrl(originalUrl: string): UrlRow {
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO urls (code, original_url, clicks, created_at) VALUES (?, ?, 0, ?)",
  );

  // Retry a few times on the astronomical chance of a code collision.
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    try {
      insert.run(code, originalUrl, Date.now());
      return {
        code,
        original_url: originalUrl,
        clicks: 0,
        created_at: Date.now(),
      };
    } catch (err) {
      const e = err as { code?: string };
      if (e.code !== "SQLITE_CONSTRAINT_PRIMARYKEY") throw err;
    }
  }
  throw new Error("Failed to generate a unique short code");
}

export function findUrlByCode(code: string): UrlRow | undefined {
  return getDb()
    .prepare("SELECT code, original_url, clicks, created_at FROM urls WHERE code = ?")
    .get(code) as UrlRow | undefined;
}

export function incrementClicks(code: string): void {
  getDb().prepare("UPDATE urls SET clicks = clicks + 1 WHERE code = ?").run(code);
}

export function listUrls(): UrlRow[] {
  return getDb()
    .prepare("SELECT code, original_url, clicks, created_at FROM urls ORDER BY created_at DESC")
    .all() as UrlRow[];
}
