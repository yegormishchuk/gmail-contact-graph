import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'fs';
import { config } from '../config.js';
import { ensureSchema } from './schema.js';

let db: SqlJsDatabase | null = null;
let SQL: SqlJsStatic | null = null;
const reloadListeners: Array<() => void> = [];

export async function getSqlJs(): Promise<SqlJsStatic> {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

/**
 * Opens the working database if there is one. Without it the server starts
 * empty and waits for an import; data routes answer 409 until then.
 */
export async function initDatabase(): Promise<SqlJsDatabase | null> {
  if (db) return db;

  const sql = await getSqlJs();
  recoverDataFiles(config.CONTACTS_DB_FILE);

  if (existsSync(config.CONTACTS_DB_FILE)) {
    db = openFile(sql, config.CONTACTS_DB_FILE);
  }
  return db;
}

function openFile(sql: SqlJsStatic, file: string): SqlJsDatabase {
  const opened = new sql.Database(readFileSync(file));
  ensureSchema(opened);
  return opened;
}

export function hasDatabase(): boolean {
  return db !== null;
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('No database: not initialized, or nothing has been imported yet.');
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

/** Called after a swap, so modules can drop what they cached from the old DB. */
export function onDatabaseReload(listener: () => void): void {
  reloadListeners.push(listener);
}

/**
 * Makes `next` the working database, in memory and on disk.
 *
 * The parsers never write the working file: an import builds `next` from
 * contacts.db.new, and only this function replaces contacts.db, by rename.
 * The file it replaces is kept as contacts.db.prev. If the new file cannot be
 * put in place the previous one is moved back, the in-memory database stays
 * as it was and the error propagates.
 *
 * Synchronous, so no request can observe a half-swapped state.
 */
export function swapDatabase(next: SqlJsDatabase): void {
  const file = config.CONTACTS_DB_FILE;
  const tmp = file + '.swap';
  const prevFile = file + '.prev';

  ensureSchema(next);
  // Not closeDatabase(): it saves, and the old data would overwrite the file.
  writeFileSync(tmp, Buffer.from(next.export()));

  const hadFile = existsSync(file);
  try {
    if (hadFile) renameWithRetry(file, prevFile);
    renameWithRetry(tmp, file);
  } catch (err) {
    if (hadFile && !existsSync(file)) {
      try {
        renameWithRetry(prevFile, file);
      } catch (restoreErr) {
        console.error(`Could not restore ${prevFile}; it is left for manual recovery:`, restoreErr);
      }
    }
    rmSync(tmp, { force: true });
    throw err;
  }

  const prev = db;
  db = next;
  prev?.close();
  for (const listener of reloadListeners) listener();
}

/**
 * Cleans up after an import or swap that the process did not live to finish.
 *
 * Parser output (.new and its WAL files) and a half-written .swap are
 * dropped. A missing working file next to a .prev means the process died
 * between the two renames of a swap, so the previous file goes back in place.
 */
export function recoverDataFiles(file: string): void {
  for (const suffix of ['.new', '.new-wal', '.new-shm', '.swap']) {
    rmSync(file + suffix, { force: true });
  }
  if (!existsSync(file) && existsSync(file + '.prev')) {
    console.warn(`${file} is missing; restoring it from ${file}.prev (an interrupted import)`);
    renameWithRetry(file + '.prev', file);
  }
}

// Only the tests replace it, to simulate a file that stays locked.
let rename: (from: string, to: string) => void = renameSync;

const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_MS = 100;

/**
 * renameSync, retried on Windows sharing errors. sql.js holds no handle on
 * the file, but an antivirus scanner or the search indexer may open it for a
 * moment right after it is written.
 */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= RENAME_ATTEMPTS || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        throw err;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_MS);
    }
  }
}

export const _testing = {
  realRename: renameSync as (from: string, to: string) => void,
  setRename(fn: (from: string, to: string) => void) {
    rename = fn;
  },
  openFile,
};
