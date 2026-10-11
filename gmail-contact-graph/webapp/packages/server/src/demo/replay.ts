import type { DemoReplay } from '@gmail-graph/shared';
import type { ProgressSnapshot } from '../import/progress.js';

/** Steps the mails phase is replayed in: the parser reports one for a small mbox. */
export const MAILS_STEPS = 12;

/**
 * Turns the progress snapshots of the demo's import into a timeline of
 * `durationMs`. The real import takes a fraction of a second, so the timing
 * is made up: each phase gets an equal share, in the order the phases came,
 * and its snapshots are spaced evenly within it.
 */
export function buildReplay(recording: ProgressSnapshot[], durationMs: number): DemoReplay {
  const segments: ProgressSnapshot[][] = [];
  let last: ProgressSnapshot | undefined;
  for (const snapshot of recording) {
    if (last && sameSnapshot(last, snapshot)) continue;
    if (last?.phase === snapshot.phase) segments[segments.length - 1].push(snapshot);
    else segments.push([snapshot]);
    last = snapshot;
  }

  const slot = durationMs / Math.max(segments.length, 1);
  const steps = segments.flatMap((segment, k) => {
    const snapshots = segment[0].phase === 'mails' ? countUp(segment) : segment;
    return snapshots.map((snapshot, j) => ({
      atMs: Math.round(k * slot + (j * slot) / snapshots.length),
      ...snapshot,
    }));
  });
  return { durationMs, steps };
}

/** The mails phase as MAILS_STEPS steps up to its last snapshot. */
function countUp(segment: ProgressSnapshot[]): ProgressSnapshot[] {
  const end = segment[segment.length - 1];
  if (end.progress === null) return segment;
  // The detail is ProgressTracker's "N messages".
  const total = Number(end.detail.match(/^([\d,]+) messages$/)?.[1].replace(/,/g, ''));
  return Array.from({ length: MAILS_STEPS }, (_, i) => {
    const f = (i + 1) / MAILS_STEPS;
    return {
      phase: end.phase,
      progress: end.progress! * f,
      detail: Number.isFinite(total) ? `${Math.round(total * f).toLocaleString('en-US')} messages` : end.detail,
    };
  });
}

function sameSnapshot(a: ProgressSnapshot, b: ProgressSnapshot): boolean {
  return a.phase === b.phase && a.progress === b.progress && a.detail === b.detail;
}
