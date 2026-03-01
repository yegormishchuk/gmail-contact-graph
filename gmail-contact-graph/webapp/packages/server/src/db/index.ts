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
