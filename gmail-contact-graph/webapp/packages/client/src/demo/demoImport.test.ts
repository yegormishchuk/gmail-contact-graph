import assert from 'node:assert/strict';
import type { DemoReplay } from '@gmail-graph/shared';
import {
  DEMO_KEY, cancelDemoImport, completedDemoImport, demoStatus, memoryStorage, resetDemoImport, startDemoImport,
  type DemoStorage,
} from './demoImport.js';

const REPLAY: DemoReplay = {
  durationMs: 8000,
  steps: [
    { atMs: 0, phase: 'mails', progress: 0.1, detail: '80 messages' },
    { atMs: 1000, phase: 'contacts', progress: 0.85, detail: '' },
    { atMs: 7000, phase: 'finalizing', progress: 0.99, detail: '' },
  ],
};
const REQ = { mbox: 'sample.mbox', email: 'you@example.com', name: 'Sam', includeCalendar: true };
const T0 = 1_000_000;

// 1. Nothing stored: the empty import screen.
{
  const s = memoryStorage();
  assert.deepEqual(demoStatus(s, REPLAY, T0), { state: 'empty', demo: true });
  assert.equal(completedDemoImport(s, REPLAY, T0), null);
}

// 2. A first import replays the timeline, then is ready.
{
  const s = memoryStorage();
  const started = startDemoImport(s, REPLAY, REQ, T0);
  assert.deepEqual(started, {
    state: 'importing', phase: 'mails', progress: 0.1, detail: '80 messages', startedAt: T0, hasData: false, demo: true,
  });
  assert.deepEqual(demoStatus(s, REPLAY, T0 + 999), started);
  assert.equal((demoStatus(s, REPLAY, T0 + 1000) as { phase: string }).phase, 'contacts');
  assert.equal((demoStatus(s, REPLAY, T0 + 7999) as { phase: string }).phase, 'finalizing');
  assert.equal(completedDemoImport(s, REPLAY, T0 + 7999), null, 'the data is not there until the end');

  assert.deepEqual(demoStatus(s, REPLAY, T0 + 8000), {
    state: 'ready', userEmail: 'you@example.com', importedAt: T0 + 8000, source: 'sample.mbox', demo: true,
  });
  assert.deepEqual(completedDemoImport(s, REPLAY, T0 + 8000), { startedAt: T0, name: 'Sam', includeCalendar: true });
}

// 3. A re-import keeps the current data while it runs; its end is a new importedAt.
{
  const s = memoryStorage();
  startDemoImport(s, REPLAY, REQ, T0);
  const T1 = T0 + 60_000;
  const re = startDemoImport(s, REPLAY, { ...REQ, name: '', includeCalendar: false }, T1);
  assert.equal(re.state, 'importing');
  assert.equal((re as { hasData: boolean }).hasData, true);
  assert.equal(completedDemoImport(s, REPLAY, T1 + 10)!.name, 'Sam', 'the previous data is still shown');

  const done = demoStatus(s, REPLAY, T1 + 8000);
  assert.equal(done.state === 'ready' && done.importedAt, T1 + 8000);
  assert.deepEqual(completedDemoImport(s, REPLAY, T1 + 8000), { startedAt: T1, name: '', includeCalendar: false });
}

// 4. Requests the server would refuse are refused.
{
  const s = memoryStorage();
  assert.throws(() => startDemoImport(s, REPLAY, { ...REQ, mbox: 'other.mbox' }, T0), /sample\.mbox/);
  assert.throws(() => startDemoImport(s, REPLAY, { ...REQ, email: 'me@gmail.com' }, T0), /you@example\.com/);
  assert.throws(() => cancelDemoImport(s, REPLAY, T0), /No import is running/);
  // The email is compared as the server does: trimmed, any case.
  startDemoImport(s, REPLAY, { ...REQ, email: ' You@Example.com ' }, T0);
  assert.throws(() => startDemoImport(s, REPLAY, REQ, T0 + 1), /already running/);
}

// 5. Cancel, like the server: 'failed' with error 'cancelled', previous data kept.
{
  const s = memoryStorage();
  startDemoImport(s, REPLAY, REQ, T0);
  assert.deepEqual(cancelDemoImport(s, REPLAY, T0 + 500), {
    state: 'failed', error: 'cancelled', log: [], failedAt: T0 + 500, hasData: false, demo: true,
  });
  assert.equal(demoStatus(s, REPLAY, T0 + 9000).state, 'failed', 'a cancelled import never completes');

  startDemoImport(s, REPLAY, REQ, T0 + 10_000);
  startDemoImport(s, REPLAY, { ...REQ, name: 'Other' }, T0 + 20_000);
  const cancelled = cancelDemoImport(s, REPLAY, T0 + 21_000);
  assert.equal(cancelled.state === 'failed' && cancelled.hasData, true);
  assert.equal(completedDemoImport(s, REPLAY, T0 + 30_000)!.name, 'Sam');
  // The next import clears the cancellation.
  startDemoImport(s, REPLAY, REQ, T0 + 40_000);
  assert.equal(demoStatus(s, REPLAY, T0 + 50_000).state, 'ready');
}

// 6. Reset returns to the empty import screen.
{
  const s = memoryStorage();
  startDemoImport(s, REPLAY, REQ, T0);
  resetDemoImport(s);
  assert.deepEqual(demoStatus(s, REPLAY, T0 + 9000), { state: 'empty', demo: true });
}

// 7. Whatever is stored, the visitor is never stuck: unreadable is empty.
{
  for (const raw of ['not json', '42', 'null', '{"data":{"startedAt":"x"}}', '{"running":{}}']) {
    const s = memoryStorage();
    s.setItem(DEMO_KEY, raw);
    assert.deepEqual(demoStatus(s, REPLAY, T0), { state: 'empty', demo: true }, raw);
    startDemoImport(s, REPLAY, REQ, T0);
    assert.equal(demoStatus(s, REPLAY, T0 + 8000).state, 'ready', raw);
  }
  const throwing: DemoStorage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  assert.deepEqual(demoStatus(throwing, REPLAY, T0), { state: 'empty', demo: true });
  assert.doesNotThrow(() => resetDemoImport(throwing));
}

// 8. A clock behind the stored start (another device, a changed clock)
//    shows the import's first step rather than nothing.
{
  const s = memoryStorage();
  startDemoImport(s, REPLAY, REQ, T0);
  assert.equal((demoStatus(s, REPLAY, T0 - 5000) as { phase: string }).phase, 'mails');
}

// 9. A replay without steps (the fallback) still runs and ends.
{
  const s = memoryStorage();
  const empty = { durationMs: 8000, steps: [] };
  const st = startDemoImport(s, empty, REQ, T0);
  assert.equal(st.state === 'importing' && st.phase, 'mails');
  assert.equal(demoStatus(s, empty, T0 + 8000).state, 'ready');
}

console.log('demoImport: all assertions passed');
