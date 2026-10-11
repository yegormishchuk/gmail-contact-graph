import type { DemoReplay } from '@gmail-graph/shared';
import { config } from '../config.js';
import type { ProgressSnapshot } from '../import/progress.js';
import { getImportStatus, startImport } from '../import/importer.js';
import { buildReplay } from './replay.js';

let replay: DemoReplay | null = null;

/**
 * Imports demo/ with the real parsers and records the import, which every
 * visitor's browser then replays (see buildReplay). Runs before the server
 * listens, so it never serves a demo without data. Rejects if the import fails.
 */
export async function bootDemo(): Promise<DemoReplay> {
  const recording: ProgressSnapshot[] = [];
  startImport(
    { mbox: config.DEMO_MBOX, email: config.DEMO_OWNER_EMAIL, name: '', includeCalendar: true },
    (snapshot) => recording.push(snapshot),
  );

  let status = getImportStatus();
  while (status.state === 'importing') {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = getImportStatus();
  }
  if (status.state !== 'ready') {
    const why = status.state === 'failed' ? `${status.error}\n${status.log.join('\n')}` : status.state;
    throw new Error(`The demo import failed: ${why}`);
  }

  replay = buildReplay(recording, config.DEMO_REPLAY_MS);
  return replay;
}

/** The replay recorded by bootDemo, null before it has run. */
export function getDemoReplay(): DemoReplay | null {
  return replay;
}
