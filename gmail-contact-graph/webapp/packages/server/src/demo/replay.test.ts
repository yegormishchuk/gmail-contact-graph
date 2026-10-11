import assert from 'node:assert/strict';
import { buildReplay, MAILS_STEPS } from './replay.js';
import type { ProgressSnapshot } from '../import/progress.js';

const s = (phase: ProgressSnapshot['phase'], progress: number | null, detail = ''): ProgressSnapshot =>
  ({ phase, progress, detail });

// What the demo import of demo/ records: a small mbox gives a single
// progress event, and the calendar phase is reported twice.
const RECORDING = [
  s('mails', 0),
  s('mails', 0.85, '801 messages'),
  s('contacts', 0.85),
  s('spam', 0.87),
  s('ai', 0.88, 'AI filter off: 61 contacts kept as unclear'),
  s('calendar', null),
  s('calendar', 0.97),
  s('calendar', 0.97),
  s('finalizing', 0.99),
];

// 1. Every phase gets an equal share, in the order the phases came.
{
  const replay = buildReplay(RECORDING, 6000);
  assert.equal(replay.durationMs, 6000);
  const firsts = new Map<string, number>();
  for (const step of replay.steps) if (!firsts.has(step.phase)) firsts.set(step.phase, step.atMs);
  assert.deepEqual([...firsts], [
    ['mails', 0], ['contacts', 1000], ['spam', 2000], ['ai', 3000], ['calendar', 4000], ['finalizing', 5000],
  ]);
  const ai = replay.steps.filter((x) => x.phase === 'ai');
  assert.deepEqual(ai, [{ atMs: 3000, ...RECORDING[4] }], 'one snapshot holds its whole slot');
}

// 2. The mails phase fills its slot with evenly spaced steps up to the
//    recorded progress, counting the messages up to the recorded total.
{
  const mails = buildReplay(RECORDING, 6000).steps.filter((x) => x.phase === 'mails');
  assert.equal(mails.length, MAILS_STEPS);
  mails.forEach((step, i) => {
    const f = (i + 1) / MAILS_STEPS;
    assert.equal(step.atMs, Math.round((i * 1000) / MAILS_STEPS));
    assert.equal(step.progress, 0.85 * f);
    assert.equal(step.detail, `${Math.round(801 * f).toLocaleString('en-US')} messages`);
  });
  assert.equal(mails.at(-1)!.detail, '801 messages');
}

// 3. Snapshots in other phases are spaced evenly, repeats dropped.
{
  const calendar = buildReplay(RECORDING, 6000).steps.filter((x) => x.phase === 'calendar');
  assert.deepEqual(calendar, [
    { atMs: 4000, phase: 'calendar', progress: null, detail: '' },
    { atMs: 4500, phase: 'calendar', progress: 0.97, detail: '' },
  ]);
}

// 4. Steps are in time order and all inside the duration.
{
  const { steps } = buildReplay(RECORDING, 8000);
  assert.equal(steps[0].atMs, 0);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i].atMs > steps[i - 1].atMs, `step ${i}`);
  assert.ok(steps.at(-1)!.atMs < 8000);
}

// 5. Without a byte count (a parser older than the JSON progress), the mails
//    phase is replayed as recorded.
{
  const replay = buildReplay([s('mails', null, 'reading'), s('finalizing', null)], 1000);
  assert.deepEqual(replay.steps, [
    { atMs: 0, phase: 'mails', progress: null, detail: 'reading' },
    { atMs: 500, phase: 'finalizing', progress: null, detail: '' },
  ]);
}

// 6. Nothing recorded, nothing to replay.
assert.deepEqual(buildReplay([], 8000), { durationMs: 8000, steps: [] });

console.log('replay.test: all assertions passed');
