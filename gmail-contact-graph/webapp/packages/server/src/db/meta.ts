import type { Database as SqlJsDatabase } from 'sql.js';
import { config } from '../config.js';
import { getDatabase, hasDatabase } from './index.js';

export function getMeta(db: SqlJsDatabase, key: string): string | null {
  const hasTable = db.exec(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'`).length > 0;
  if (!hasTable) return null;
  const stmt = db.prepare(`SELECT value FROM meta WHERE key = ?`);
  stmt.bind([key]);
  const value = stmt.step() ? String(stmt.get()[0]) : null;
  stmt.free();
  return value;
}

export function setMeta(db: SqlJsDatabase, key: string, value: string): void {
  db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, value]);
}

/**
 * The mailbox owner: the email recorded by the import that built the current
 * database, else USER_EMAIL from the environment (databases built by the CLI).
 */
export function getUserEmail(): string {
  const fromMeta = hasDatabase() ? getMeta(getDatabase(), 'user_email') : null;
  return fromMeta || config.ENV_USER_EMAIL;
}

export function getUserName(): string {
  return config.ENV_USER_NAME || getUserEmail().split('@')[0] || 'Me';
}
