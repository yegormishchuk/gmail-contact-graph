import type { Database as SqlJsDatabase } from 'sql.js';

/**
 * Creates the tables the server relies on but the parsers may not have made.
 *
 * Runs on every database the server starts serving: the one opened at start
 * and each one swapped in by an import. Idempotent.
 */
export function ensureSchema(db: SqlJsDatabase): void {
  // fill_db only creates contacts_filtered when at least one contact survives
  // the spam filter. With zero contacts (wrong mbox or USER_EMAIL) the table is
  // missing and every query joining it would fail, so start from an empty one.
  db.run(`
    CREATE TABLE IF NOT EXISTS contacts_filtered (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL UNIQUE REFERENCES contacts(id),
      not_clear  INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Written by the server when it imports a mailbox (user_email, imported_at,
  // source). The parsers do not know about it.
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  // Manual contact edits, re-applied after a re-import (see overrides.ts).
  db.run(`
    CREATE TABLE IF NOT EXISTS user_overrides (
      email      TEXT PRIMARY KEY,
      action     TEXT NOT NULL CHECK (action IN ('clear', 'not_human', 'restore')),
      updated_at INTEGER NOT NULL
    )
  `);
}
