import assert from 'node:assert/strict';
import { formatBytes, formatElapsed, phaseLabel, progressPercent } from './importFormat.js';

// 1. File sizes as the import screen lists them.
{
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(900), '900 B');
  assert.equal(formatBytes(5656), '5.5 KB');
  assert.equal(formatBytes(48 * 1024 * 1024), '48 MB');
  assert.equal(formatBytes(1269565311), '1.2 GB');
}

// 2. Elapsed time.
{
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(65_400), '1:05');
  assert.equal(formatElapsed(3_725_000), '1:02:05');
  assert.equal(formatElapsed(-5), '0:00');
}

// 3. Phase names.
{
  assert.equal(phaseLabel('mails'), 'Reading emails');
  assert.equal(phaseLabel('finalizing'), 'Finishing up');
}

// 4. Whole percent for the bar and the banner; null stays unknown.
{
  assert.equal(progressPercent(0.425), 42);
  assert.equal(progressPercent(1), 100);
  assert.equal(progressPercent(null), null);
}

console.log('importFormat: all assertions passed');
