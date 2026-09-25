import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import type { ImportStatus, StartImportRequest } from '@gmail-graph/shared';
import { config } from '../config.js';
import { getDatabase, getSqlJs, hasDatabase, swapDatabase } from '../db/index.js';
import { getMeta, getUserEmail, setMeta } from '../db/meta.js';
import { carryOverOverrides } from '../db/overrides.js';
import { ensureSchema } from '../db/schema.js';
import { ProgressTracker } from './progress.js';
import { countIcs, listMbox, resolveMbox, type SourceRef } from './sources.js';
import { setImporting } from './state.js';

/**
 * Runs an import: fill_db (and fill_events) write contacts.db.new, which is
 * then checked, given meta and the user's edits, and swapped in.
 *
 * The parsers never touch contacts.db, so a failed or cancelled import leaves
 * the working data exactly as it was. One import at a time.
 */

const LOG_LINES = 200;

interface Job {
  tracker: ProgressTracker;
  startedAt: number;
  log: string[];
  child: ChildProcess | null;
  cancelled: boolean;
}

let job: Job | null = null;
let failure: { error: string; log: string[]; failedAt: number } | null = null;

/** Rejects a request before anything starts; `status` is the HTTP status. */
export class ImportRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getImportStatus(): ImportStatus {
  if (job) {
    return { state: 'importing', ...job.tracker.snapshot(), startedAt: job.startedAt, hasData: hasDatabase() };
  }
  if (failure) {
    return { state: 'failed', ...failure, hasData: hasDatabase() };
  }
  if (!hasDatabase()) return { state: 'empty' };

  const importedAt = Number(getMeta(getDatabase(), 'imported_at'));
  return {
    state: 'ready',
    userEmail: getUserEmail(),
    importedAt: Number.isFinite(importedAt) && importedAt > 0 ? importedAt : null,
    source: currentSource()?.name ?? null,
  };
}

/** The mbox the working data was imported from, as recorded in meta. */
export function currentSource(): SourceRef | null {
  if (!hasDatabase()) return null;
  const raw = getMeta(getDatabase(), 'source');
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value?.name === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function startImport(body: unknown): ImportStatus {
  if (job) throw new ImportRequestError(409, 'An import is already running.');

  const req = (body ?? {}) as Partial<StartImportRequest>;
  if (typeof req.mbox !== 'string' || !req.mbox) {
    throw new ImportRequestError(400, 'An mbox file name is required.');
  }
  const mboxPath = resolveMbox(req.mbox);
  if (!mboxPath) {
    throw new ImportRequestError(400, `No file named ${JSON.stringify(req.mbox)} in ${config.MBOX_DIR}.`);
  }
  const email = typeof req.email === 'string' ? req.email.trim().toLowerCase() : '';
  if (!email.includes('@')) throw new ImportRequestError(400, 'A valid email address is required.');
  if (!existsSync(config.FILL_DB_BIN)) {
    throw new ImportRequestError(500,
      `The parser is not built (${config.FILL_DB_BIN}). Run: cd gmail-mbox-parser && make build-parser`);
  }

  // Recorded as listed, so the import screen can mark this file as current.
  const source = listMbox().find((f) => f.name === path.basename(mboxPath));
  if (!source) throw new ImportRequestError(400, `${mboxPath} disappeared.`);
  // Refused rather than skipped: the new data would silently lose the
  // calendar the current data has.
  const withCalendar = req.includeCalendar === true;
  if (withCalendar && countIcs() === 0) {
    throw new ImportRequestError(400, `No .ics files in ${config.CALENDAR_DIR}.`);
  }
  if (withCalendar && !existsSync(config.FILL_EVENTS_BIN)) {
    throw new ImportRequestError(400,
      `The calendar parser is not built (${config.FILL_EVENTS_BIN}). Run: cd calendar-parser && make build`);
  }

  // A parser left running by a server that was killed can still hold the file.
  if (!removeParserOutput()) {
    throw new ImportRequestError(409,
      `${newDbFile()} is still in use, probably by a parser from an earlier run. Try again once it exits.`);
  }
  failure = null;
  const current: Job = { tracker: new ProgressTracker(), startedAt: Date.now(), log: [], child: null, cancelled: false };
  job = current;
  setImporting(true);
  run(current, mboxPath, email, withCalendar, source).catch((err) => {
    // run() handles its own errors; this is only a last line of defence
    // against an unhandled rejection taking the server down.
    console.error('Import crashed:', err);
  });
  return getImportStatus();
}

/** Kills the running parser, if any. For a server that is shutting down. */
export function stopParser(): void {
  job?.child?.kill();
}

/**
 * Stops the running import. The status turns to failed ('cancelled') once
 * the parser has exited and its output is removed.
 */
export function cancelImport(): ImportStatus {
  if (!job) throw new ImportRequestError(409, 'No import is running.');
  job.cancelled = true;
  job.child?.kill();
  return getImportStatus();
}

async function run(current: Job, mboxPath: string, email: string, withCalendar: boolean, source: SourceRef) {
  const dbNew = newDbFile();
  try {
    mkdirSync(path.dirname(dbNew), { recursive: true });
    await runParser(current, config.FILL_DB_BIN, [mboxPath, email, dbNew]);
    if (withCalendar) {
      current.tracker.setPhase('calendar');
      await runParser(current, config.FILL_EVENTS_BIN,
        [config.CALENDAR_DIR, '--db', dbNew, '--user-email', email]);
    }
    current.tracker.setPhase('finalizing');
    await finalize(current, dbNew, email, source);
  } catch (err) {
    // Best effort: whatever stays behind is removed at the next start.
    removeParserOutput();
    const error = current.cancelled ? 'cancelled' : (err as Error).message;
    console.error(`Import failed: ${error}`);
    failure = { error, log: current.log, failedAt: Date.now() };
  } finally {
    job = null;
    setImporting(false);
  }
}

function runParser(current: Job, bin: string, args: string[]): Promise<void> {
  if (current.cancelled) return Promise.reject(new Error('cancelled'));

  // cwd = DATA_DIR: the parsers read ../.env relative to it, which is the
  // project .env natively. The server's own environment (HF_API_KEY and all)
  // is passed on, and dotenvy does not override it.
  mkdirSync(config.DATA_DIR, { recursive: true });
  const child = spawn(bin, args, {
    cwd: config.DATA_DIR,
    env: { ...process.env, PROGRESS_FORMAT: 'json' },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  current.child = child;

  createInterface({ input: child.stderr! }).on('line', (line) => {
    if (current.tracker.feed(line)) return;
    console.log(`[${path.basename(bin)}] ${line}`);
    current.log.push(line);
    if (current.log.length > LOG_LINES) current.log.shift();
  });

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    // 'close' comes after stderr is drained, so every line has been read.
    child.once('close', (code, signal) => {
      current.child = null;
      if (current.cancelled) return reject(new Error('cancelled'));
      if (code === 0) return resolve();
      const why = signal ? `was killed (${signal})` : `exited with code ${code}`;
      reject(new Error(lastMeaningfulLine(current.log) ?? `${path.basename(bin)} ${why}`));
    });
  });
}

async function finalize(current: Job, dbNew: string, email: string, source: SourceRef) {
  // sql.js reads the main file only. Both parsers checkpoint their WAL into it
  // before exiting, so anything left in a -wal file would be lost data.
  const wal = dbNew + '-wal';
  if (existsSync(wal) && statSync(wal).size > 0) throw new Error('WAL not checkpointed');
  removeQuietly(wal);
  removeQuietly(dbNew + '-shm');

  const SQL = await getSqlJs();
  if (current.cancelled) throw new Error('cancelled');

  // No await from here on: the journal read from the current database and the
  // swap happen with no request in between.
  const next = new SQL.Database(readFileSync(dbNew));
  try {
    const hasContacts = next.exec(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='contacts'`).length > 0;
    if (!hasContacts) throw new Error('The parser output has no contacts table.');

    ensureSchema(next);
    setMeta(next, 'user_email', email);
    setMeta(next, 'imported_at', String(Date.now()));
    setMeta(next, 'source', JSON.stringify(source));

    if (hasDatabase()) {
      const { copied, applied } = carryOverOverrides(getDatabase(), next, getUserEmail(), email);
      if (copied) console.log(`Import: ${copied} manual edits carried over, ${applied} changed the new data`);
    }
    swapDatabase(next);
  } catch (err) {
    // Unless the swap got as far as making it the working database.
    if (!hasDatabase() || getDatabase() !== next) next.close();
    throw err;
  }
  // The import has succeeded; a copy that cannot be deleted right now is
  // removed at the next start.
  removeQuietly(dbNew);
  // The command-line parse (docker/parse-entrypoint.sh) skips when this stamp
  // matches its mbox; the database it vouched for has just been replaced.
  removeQuietly(path.join(config.DATA_DIR, '.parse-stamp'));
}

function newDbFile(): string {
  return config.CONTACTS_DB_FILE + '.new';
}

/** Deletes the parser output. Returns false if some of it could not be deleted. */
function removeParserOutput(): boolean {
  let removed = true;
  for (const suffix of ['', '-wal', '-shm']) removed = removeQuietly(newDbFile() + suffix) && removed;
  return removed;
}

// On Windows a scanner or indexer may hold a freshly written file for a
// moment, and a parser that outlived its server holds its output until it
// exits. Neither is worth failing (or crashing) over.
function removeQuietly(file: string): boolean {
  try {
    rmSync(file, { force: true });
    return true;
  } catch (err) {
    console.warn(`Could not delete ${file}:`, (err as Error).message);
    return false;
  }
}

// The last stderr line worth showing as the error. Rust panics end with a
// hint about RUST_BACKTRACE, which says nothing about what went wrong.
function lastMeaningfulLine(log: string[]): string | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const line = log[i].trim();
    if (line && !line.startsWith('note: run with `RUST_BACKTRACE')) return line;
  }
  return null;
}
