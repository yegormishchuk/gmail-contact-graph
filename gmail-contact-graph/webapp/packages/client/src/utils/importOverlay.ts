import type { ImportStatus } from '@gmail-graph/shared';

/** Grey nodes in the cloud while the import runs. */
export const PLACEHOLDER_COUNT = 150;
/** Even a fast import shows the loop this long before the ending. */
export const MIN_LOOP_MS = 2000;

const STAGGER_MS = 20;
const MAX_CLEANUP_MS = 4000;

/** The placeholder loop gives way to the real contacts once the import is done. */
export function shouldEndLoop(status: ImportStatus | null, loopElapsedMs: number): boolean {
  return status?.state === 'ready' && loopElapsedMs >= MIN_LOOP_MS;
}

/**
 * How the placeholder cloud turns into the real contacts: the first `reuse`
 * placeholders stand for contacts in place, then `add` new nodes join or
 * `remove` leftover placeholders leave.
 */
export function morphPlan(placeholderCount: number, realCount: number) {
  return {
    reuse: Math.min(placeholderCount, realCount),
    add: Math.max(0, realCount - placeholderCount),
    remove: Math.max(0, placeholderCount - realCount),
  };
}

/** Delay between spam nodes vanishing, so the whole cleanup stays short. */
export function cleanupStagger(excludedCount: number): number {
  if (excludedCount <= 0) return STAGGER_MS;
  return Math.min(STAGGER_MS, MAX_CLEANUP_MS / excludedCount);
}
