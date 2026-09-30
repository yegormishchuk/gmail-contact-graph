import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { config } from '../config.js';
import type { FillDbTimings } from './progress.js';
import type { SourceRef } from './sources.js';

const STAGE_ORDER = ['mails', 'contacts', 'spam', 'ai', 'checkpoint'];

/** What the importer measured around the parsers, in milliseconds. */
export interface ImportTimings {
  fillDbWallMs: number;
  calendarMs: number | null;
  finalizeMs: number;
  totalMs: number;
}

/**
 * Logs the stage timings of a successful import and appends them to
 * benchmarks/timings.jsonl next to contacts.db, where a command-line fill_db
 * run appends its own ("mode": "cli") in the same format.
 */
export function recordImportTimings(fillDb: FillDbTimings, source: SourceRef, outer: ImportTimings): void {
  // fill_db's JSON has its keys sorted; the log shows them in the order they run.
  const order = (stage: string) => {
    const i = STAGE_ORDER.indexOf(stage);
    return i < 0 ? STAGE_ORDER.length : i;
  };
  const rows: [string, number | null][] = [
    ...Object.entries(fillDb.stagesMs).sort(([a], [b]) => order(a) - order(b)),
    ['fill_db total', fillDb.totalMs],
    ['fill_db wall', outer.fillDbWallMs],
    ['calendar', outer.calendarMs],
    ['finalize', outer.finalizeMs],
    ['total', outer.totalMs],
  ];
  console.log(`Import timings (${source.name}):\n${rows
    .filter(([, ms]) => ms !== null)
    .map(([name, ms]) => `  ${name.padEnd(14)} ${(ms! / 1000).toFixed(3).padStart(8)} s`)
    .join('\n')}`);

  const record = {
    mode: 'webapp',
    at: new Date().toISOString(),
    mbox: source.name,
    mbox_bytes: source.size,
    messages: fillDb.messages,
    contacts: fillDb.contacts,
    ai_enabled: fillDb.aiEnabled,
    stages_ms: fillDb.stagesMs,
    fill_db_total_ms: fillDb.totalMs,
    fill_db_wall_ms: outer.fillDbWallMs,
    calendar_ms: outer.calendarMs,
    finalize_ms: outer.finalizeMs,
    total_ms: outer.totalMs,
  };
  const file = path.join(path.dirname(config.CONTACTS_DB_FILE), 'benchmarks', 'timings.jsonl');
  // The import has already succeeded; a record that cannot be written is not worth failing it.
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(record) + '\n');
  } catch (err) {
    console.warn(`Could not write timings to ${file}:`, (err as Error).message);
  }
}
