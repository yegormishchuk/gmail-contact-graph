import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { config } from '../config.js';

let db: SqlJsDatabase | null = null;
let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

export async function initDatabase(): Promise<SqlJsDatabase> {
  if (db) return db;

  SQL = await initSqlJs();

  if (existsSync(config.CONTACTS_DB_FILE)) {
    const buffer = readFileSync(config.CONTACTS_DB_FILE);
    db = new SQL.Database(buffer);
  } else {
    throw new Error(`Database file not found: ${config.CONTACTS_DB_FILE}`);
  }

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

  return db;
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(config.CONTACTS_DB_FILE, buffer);
}

export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}
