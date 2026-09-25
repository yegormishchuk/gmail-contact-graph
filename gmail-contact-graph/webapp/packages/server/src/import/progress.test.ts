import assert from 'node:assert/strict';
import { ProgressTracker } from './progress.js';

// 1. JSON events from fill_db drive phase, overall progress and detail.
{
  const t = new ProgressTracker();
  assert.equal(t.feed('{"event":"phase","phase":"mails"}'), true);
  assert.deepEqual(t.snapshot(), { phase: 'mails', progress: 0, detail: '' });

  t.feed('{"event":"progress","phase":"mails","bytes":500,"total_bytes":1000,"messages":95000}');
  assert.deepEqual(t.snapshot(), { phase: 'mails', progress: 0.425, detail: '95,000 messages' });

  t.feed('{"event":"phase","phase":"contacts"}');
  assert.deepEqual(t.snapshot(), { phase: 'contacts', progress: 0.85, detail: '' });

  t.feed('{"event":"phase","phase":"spam"}');
  assert.equal(t.snapshot().progress, 0.87);

  t.feed('{"event":"phase","phase":"ai","enabled":true,"contacts":1540}');
  assert.deepEqual(t.snapshot(), { phase: 'ai', progress: 0.88, detail: 'Checking 1,540 contacts with AI' });

  t.feed('{"event":"done","messages":310211,"contacts":8123,"filtered":1320}');
  assert.equal(t.snapshot().phase, 'ai', 'done does not move the phase');
}

// 2. The AI phase without a key says so.
{
  const t = new ProgressTracker();
  t.feed('{"event":"phase","phase":"ai","enabled":false,"contacts":7}');
  assert.equal(t.snapshot().detail, 'AI filter off: 7 contacts kept as unclear');
}

// 3. Phases set by the importer itself.
{
  const t = new ProgressTracker();
  t.setPhase('calendar');
  assert.deepEqual(t.snapshot(), { phase: 'calendar', progress: null, detail: '' });
  t.feed('{"event":"phase","phase":"calendar"}');
  assert.equal(t.snapshot().progress, 0.97);
  t.setPhase('finalizing');
  assert.deepEqual(t.snapshot(), { phase: 'finalizing', progress: 0.99, detail: '' });
}

// 4. A parser without JSON output: no percentage, the text line as detail.
//    Its [progress] lines count as progress output, not as log lines.
{
  const t = new ProgressTracker();
  assert.equal(t.feed('     mbox: data.mbox'), false);
  assert.equal(t.feed('[progress] 5000 messages, 5100 rows, 3 skipped'), true);
  assert.deepEqual(t.snapshot(), { phase: 'mails', progress: null, detail: '5000 messages, 5100 rows, 3 skipped' });
}

// 5. Garbage that looks like JSON is treated as a log line.
{
  const t = new ProgressTracker();
  assert.equal(t.feed('{not json'), false);
  assert.equal(t.feed('{"event":"progress","phase":"mails","bytes":1,"total_bytes":0,"messages":1}'), true);
  assert.equal(t.snapshot().progress, 0, 'a zero total does not divide by zero');
  assert.equal(t.feed('{"event":"phase","phase":"bogus"}'), true);
  assert.equal(t.snapshot().phase, 'mails', 'an unknown phase is ignored');
}

// 6. Progress never goes backwards past the phase's range.
{
  const t = new ProgressTracker();
  t.feed('{"event":"progress","phase":"mails","bytes":2000,"total_bytes":1000,"messages":1}');
  assert.equal(t.snapshot().progress, 0.85);
}

console.log('progress.test: all assertions passed');
