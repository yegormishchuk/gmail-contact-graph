import assert from 'node:assert/strict';
import type { ImportStatus } from '@gmail-graph/shared';
import { MIN_LOOP_MS, cleanupStagger, morphPlan, shouldEndLoop } from './importOverlay.js';

const ready: ImportStatus = { state: 'ready', userEmail: 'me@x.com', importedAt: 1, source: null };
const importing: ImportStatus =
  { state: 'importing', phase: 'mails', progress: 0.5, detail: '', startedAt: 1, hasData: false };
const failed: ImportStatus = { state: 'failed', error: 'boom', log: [], failedAt: 2, hasData: false };

// 1. The loop ends only once the import is done and the loop has run long enough.
{
  assert.equal(shouldEndLoop(ready, MIN_LOOP_MS), true);
  assert.equal(shouldEndLoop(ready, MIN_LOOP_MS + 5000), true);
  assert.equal(shouldEndLoop(ready, MIN_LOOP_MS - 1), false, 'a fast import still shows the loop');
  assert.equal(shouldEndLoop(importing, MIN_LOOP_MS + 5000), false);
  assert.equal(shouldEndLoop(failed, MIN_LOOP_MS + 5000), false, 'a failure closes the overlay instead');
  assert.equal(shouldEndLoop(null, MIN_LOOP_MS + 5000), false);
}

// 2. Placeholders become contacts; the difference joins or leaves.
{
  assert.deepEqual(morphPlan(150, 400), { reuse: 150, add: 250, remove: 0 });
  assert.deepEqual(morphPlan(150, 40), { reuse: 40, add: 0, remove: 110 });
  assert.deepEqual(morphPlan(150, 150), { reuse: 150, add: 0, remove: 0 });
  assert.deepEqual(morphPlan(150, 0), { reuse: 0, add: 0, remove: 150 });
}

// 3. The cleanup keeps today's pace for a few spam contacts and never drags on for many.
{
  assert.equal(cleanupStagger(0), 20);
  assert.equal(cleanupStagger(10), 20);
  assert.equal(cleanupStagger(200), 20);
  assert.ok(cleanupStagger(3000) * 3000 <= 4000, 'thousands of spam contacts fade in about 4 s');
  assert.ok(cleanupStagger(3000) > 0);
}

console.log('importOverlay: all assertions passed');
