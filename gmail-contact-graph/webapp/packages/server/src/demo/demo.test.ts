import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Set before config.ts is loaded; the project .env never overrides these.
// DATA_DIR and CONTACTS_DB_FILE stand for a real database, which the demo
// must leave alone: it never uses them.
const dir = mkdtempSync(path.join(tmpdir(), 'gcg-demo-'));
process.env.DEMO_MODE = '1';
process.env.DATA_DIR = dir;
process.env.CONTACTS_DB_FILE = path.join(dir, 'mine.db');
delete process.env.MBOX_DIR;
delete process.env.CALENDAR_DIR;
// Demo mode must ignore a key, wherever it comes from.
process.env.HF_API_KEY = 'hf_not_for_the_demo';

const SERVER = fileURLToPath(new URL('../../', import.meta.url));
const REPO = path.resolve(SERVER, '../../../..');

const { config } = await import('../config.js');
const { createApp } = await import('../app.js');
const { initDatabase } = await import('../db/index.js');
const { bootDemo } = await import('./boot.js');

const DEMO_DATA = path.join(tmpdir(), 'gmail-contact-graph-demo');

/** config.DATA_DIR as a fresh process resolves it, with DATA_DIR unset. */
function defaultDataDir(demo: boolean): string {
  const env = { ...process.env, DATA_DIR: '', CONTACTS_DB_FILE: '', DEMO_MODE: demo ? '1' : '' };
  return execFileSync(process.execPath, [
    '--import', 'tsx', '--input-type=module',
    '-e', `const { config } = await import('./src/config.ts'); console.log(config.DATA_DIR);`,
  ], { cwd: SERVER, env, encoding: 'utf8' }).trim();
}

const server = createApp().listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function get(url: string) {
  const res = await fetch(base + url);
  return { status: res.status, body: await res.json() };
}

async function post(url: string, body: unknown) {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

try {
  // 1. Demo defaults: the generated data in demo/, its own database folder
  //    whatever DATA_DIR says, no AI filter, and the calendar's "now" pinned.
  {
    assert.equal(config.DEMO_MODE, true);
    assert.equal(config.MBOX_DIR, path.join(REPO, 'demo', 'Email'));
    assert.equal(config.CALENDAR_DIR, path.join(REPO, 'demo', 'Calendar'));
    assert.equal(config.DATA_DIR, DEMO_DATA);
    assert.equal(config.CONTACTS_DB_FILE, path.join(DEMO_DATA, 'contacts.db'));
    assert.equal(process.env.HF_API_KEY, '');
    assert.equal(process.env.FILL_EVENTS_NOW, '2026-10-01');
    assert.equal(defaultDataDir(true), DEMO_DATA);
    assert.equal(defaultDataDir(false), path.join(REPO, 'data'));
  }

  // 2. Before boot (which in production runs before listen) there is no replay.
  assert.equal((await get('/api/demo/replay')).status, 404);

  if (!existsSync(config.FILL_DB_BIN) || !existsSync(config.FILL_EVENTS_BIN)) {
    console.log(`demo.test: parsers not built (${config.FILL_DB_BIN}); skipping the demo import`);
  } else {
    await initDatabase();

    // 3. Boot imports demo/ and records every phase, in order.
    const replay = await bootDemo();
    assert.equal(replay.durationMs, 8000);
    assert.deepEqual([...new Set(replay.steps.map((s) => s.phase))],
      ['mails', 'contacts', 'spam', 'ai', 'calendar', 'finalizing']);
    assert.equal(replay.steps.filter((s) => s.phase === 'mails').at(-1)!.detail, '801 messages');
    assert.match(replay.steps.find((s) => s.phase === 'ai')!.detail, /^AI filter off: \d+ contacts/);

    // 4. The API serves it to everyone.
    assert.deepEqual((await get('/api/demo/replay')).body, replay);
    const status = (await get('/api/import/status')).body;
    assert.equal(status.demo, true);
    assert.equal(status.state, 'ready');
    assert.equal(status.userEmail, 'you@example.com');
    assert.equal(status.source, 'sample.mbox');

    const sources = (await get('/api/import/sources')).body;
    assert.deepEqual(sources.mbox.map((f: { name: string }) => f.name), ['sample.mbox']);
    assert.equal(sources.defaultEmail, 'you@example.com');
    assert.equal(sources.aiEnabled, false);
    assert.equal(sources.icsCount, 1);

    assert.equal((await get('/api/graph')).body.nodes.length, 62, '61 contacts and the owner');
    // Stays 105 whatever the date, thanks to FILL_EVENTS_NOW.
    assert.equal((await get('/api/calendar-stats')).body.totalMeetings, 105);

    // 5. Read-only: edits and imports are refused, whatever the body.
    for (const url of ['/api/contacts/mark-clear', '/api/contacts/mark-not-human', '/api/contacts/restore',
      '/api/import', '/api/import/cancel']) {
      assert.deepEqual(await post(url, { email: 'x@example.com' }), {
        status: 403, body: { error: 'Not available in the demo' },
      }, url);
    }

    assert.deepEqual(readdirSync(dir), [], 'nothing written where DATA_DIR points');

    // 6. A failed import fails the boot, so a broken deploy never serves.
    //    Node stands in for fill_db and chokes on the mbox it is given.
    config.FILL_DB_BIN = process.execPath;
    await assert.rejects(bootDemo(), /The demo import failed/);
  }
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log('demo.test: all assertions passed');
