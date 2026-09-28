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
  return metaUserEmail() || config.ENV_USER_EMAIL;
}

/** The name given on import, else the local part of the owner's email. */
export function getUserName(): string {
  const metaEmail = metaUserEmail();
  const local = metaEmail ? metaEmail.split('@')[0] : config.ENV_USER_EMAIL_LOCAL;
  return metaUserName() || local || 'Me';
}

/** The name given on import, '' if none was. */
export function metaUserName(): string {
  return currentMeta('user_name').trim();
}

// Lowercased like every address the parser stores, so comparisons match.
function metaUserEmail(): string {
  return currentMeta('user_email').trim().toLowerCase();
}

function currentMeta(key: string): string {
  return (hasDatabase() ? getMeta(getDatabase(), key) : null) ?? '';
}
