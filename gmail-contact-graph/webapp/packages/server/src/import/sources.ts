import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import type { ImportSources, MboxFile } from '@gmail-graph/shared';
import { config } from '../config.js';
import { getUserEmail } from '../db/meta.js';

/** Identifies the file an import read: name plus size and mtime at the time. */
export interface SourceRef {
  name: string;
  size: number;
  modified: number;
}

/**
 * The .mbox files in MBOX_DIR, newest first. Hidden files are left out: they
 * include uploads still being written.
 */
export function listMbox(): SourceRef[] {
  const files: SourceRef[] = [];
  for (const name of readDir(config.MBOX_DIR)) {
    if (name.startsWith('.') || !name.toLowerCase().endsWith('.mbox')) continue;
    const stat = statOrNull(path.join(config.MBOX_DIR, name));
    if (!stat?.isFile()) continue;
    files.push({ name, size: stat.size, modified: Math.trunc(stat.mtimeMs) });
  }
  return files.sort((a, b) => b.modified - a.modified);
}

/**
 * Turns a file name sent by the client into a path, or null.
 *
 * The name must match an entry of a fresh listing exactly, which rules out
 * `../`, absolute paths, directories and anything outside MBOX_DIR without
 * having to reason about path syntax.
 */
export function resolveMbox(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const listed = listMbox().find((f) => f.name === name);
  return listed ? path.join(config.MBOX_DIR, listed.name) : null;
}

export function countIcs(): number {
  return readDir(config.CALENDAR_DIR).filter((name) => {
    if (!name.toLowerCase().endsWith('.ics')) return false;
    return statOrNull(path.join(config.CALENDAR_DIR, name))?.isFile() ?? false;
  }).length;
}

/** Same rule as fill_db's HFConfig: a key that is blank after trimming is off. */
export function aiEnabled(): boolean {
  return (process.env.HF_API_KEY ?? '').trim() !== '';
}

export function getSources(current: SourceRef | null): ImportSources {
  const mbox: MboxFile[] = listMbox().map((f) => ({
    ...f,
    current: current !== null
      && f.name === current.name && f.size === current.size && f.modified === current.modified,
  }));
  return {
    mboxDir: config.MBOX_DIR,
    calendarDir: config.CALENDAR_DIR,
    mbox,
    icsCount: countIcs(),
    parserAvailable: existsSync(config.FILL_DB_BIN),
    calendarParserAvailable: existsSync(config.FILL_EVENTS_BIN),
    aiEnabled: aiEnabled(),
    defaultEmail: getUserEmail(),
  };
}

function readDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function statOrNull(p: string) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}
