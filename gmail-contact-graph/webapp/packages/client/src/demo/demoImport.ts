import type { DemoReplay, ImportStatus, StartImportRequest } from '@gmail-graph/shared';

/**
 * The hosted demo's import, faked in the browser. The server holds one
 * read-only database for everyone; what each visitor imported, and when,
 * lives in their localStorage, and the import's progress is the server's
 * recorded replay played back from that moment.
 *
 * The statuses produced are the ones the real server would answer, so the
 * import screen, overlay and banner work unchanged.
 */

export const DEMO_KEY = 'demo_import_v1';
export const DEMO_OWNER_EMAIL = 'you@example.com';
export const DEMO_MBOX = 'sample.mbox';

/** The part of Storage used here; tests pass memoryStorage(). */
export type DemoStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface DemoRun {
  startedAt: number;
  /** '' means the server's default, the local part of the owner email. */
  name: string;
  includeCalendar: boolean;
}

interface DemoRecord {
  /** The completed import the graph shows. */
  data: DemoRun | null;
  /** An import started and not cancelled; done once its replay has played. */
  running: DemoRun | null;
  /** When the last import was cancelled, until the next one starts. */
  cancelledAt: number | null;
}

const EMPTY: DemoRecord = { data: null, running: null, cancelledAt: null };

export function demoStatus(storage: DemoStorage, replay: DemoReplay, now: number): ImportStatus {
  const { data, running, cancelledAt } = settled(read(storage), replay, now);
  if (running) {
    const elapsed = Math.max(0, now - running.startedAt);
    const step = replay.steps.filter((s) => s.atMs <= elapsed).at(-1) ?? replay.steps[0];
    return {
      state: 'importing',
      phase: step?.phase ?? 'mails',
      progress: step?.progress ?? null,
      detail: step?.detail ?? '',
      startedAt: running.startedAt,
      hasData: data !== null,
      demo: true,
    };
  }
  if (cancelledAt !== null) {
    return { state: 'failed', error: 'cancelled', log: [], failedAt: cancelledAt, hasData: data !== null, demo: true };
  }
  if (data) {
    return {
      state: 'ready',
      userEmail: DEMO_OWNER_EMAIL,
      // A new value per import, so the app loads the data again.
      importedAt: data.startedAt + replay.durationMs,
      source: DEMO_MBOX,
      demo: true,
    };
  }
  return { state: 'empty', demo: true };
}

/** Checks the request as the server would, then starts the replay. */
export function startDemoImport(
  storage: DemoStorage, replay: DemoReplay, req: StartImportRequest, now: number,
): ImportStatus {
  const current = settled(read(storage), replay, now);
  if (current.running) throw new Error('An import is already running.');
  if (req.mbox !== DEMO_MBOX) throw new Error(`The demo can only import ${DEMO_MBOX}.`);
  if ((req.email ?? '').trim().toLowerCase() !== DEMO_OWNER_EMAIL) {
    throw new Error(`The demo mailbox belongs to ${DEMO_OWNER_EMAIL}.`);
  }
  const running = { startedAt: now, name: (req.name ?? '').trim(), includeCalendar: req.includeCalendar === true };
  write(storage, { data: current.data, running, cancelledAt: null });
  return demoStatus(storage, replay, now);
}

/** Stops the replay; the previous data, if any, stays. */
export function cancelDemoImport(storage: DemoStorage, replay: DemoReplay, now: number): ImportStatus {
  const current = settled(read(storage), replay, now);
  if (!current.running) throw new Error('No import is running.');
  write(storage, { data: current.data, running: null, cancelledAt: now });
  return demoStatus(storage, replay, now);
}

/** Forgets every import: back to the empty import screen. */
export function resetDemoImport(storage: DemoStorage): void {
  try {
    storage.removeItem(DEMO_KEY);
  } catch {
    // Nothing stored can be read either, which is the same as empty.
  }
}

/** The import the graph currently shows: its name and calendar choice. */
export function completedDemoImport(storage: DemoStorage, replay: DemoReplay, now: number): DemoRun | null {
  return settled(read(storage), replay, now).data;
}

/** Storage that lasts as long as the page: for tests, and when localStorage is unusable. */
export function memoryStorage(): DemoStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** A finished replay is the new data. */
function settled(record: DemoRecord, replay: DemoReplay, now: number): DemoRecord {
  if (record.running && now - record.running.startedAt >= replay.durationMs) {
    return { data: record.running, running: null, cancelledAt: null };
  }
  return record;
}

// A value from an older version, another tab mid-write or a hand edit reads
// as nothing stored, so the visitor lands on the import screen, never stuck.
function read(storage: DemoStorage): DemoRecord {
  try {
    const value = JSON.parse(storage.getItem(DEMO_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return EMPTY;
    const { data, running, cancelledAt } = value;
    if (!isRunOrNull(data) || !isRunOrNull(running)) return EMPTY;
    if (cancelledAt !== null && !Number.isFinite(cancelledAt)) return EMPTY;
    return { data, running, cancelledAt };
  } catch {
    return EMPTY;
  }
}

function write(storage: DemoStorage, record: DemoRecord): void {
  try {
    storage.setItem(DEMO_KEY, JSON.stringify(record));
  } catch {
    // Unwritable storage: api/client.ts falls back to memoryStorage().
  }
}

function isRunOrNull(value: unknown): value is DemoRun | null {
  if (value === null) return true;
  const run = value as DemoRun;
  return typeof run === 'object'
    && Number.isFinite(run.startedAt)
    && typeof run.name === 'string'
    && typeof run.includeCalendar === 'boolean';
}
