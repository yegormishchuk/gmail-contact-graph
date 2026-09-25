import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImportStatus } from '@gmail-graph/shared';

// Set before config.ts is loaded; the project .env never overrides these.
const dir = mkdtempSync(path.join(tmpdir(), 'gcg-import-'));
const emailDir = path.join(dir, 'Email');
const calendarDir = path.join(dir, 'Calendar');
const dbFile = path.join(dir, 'contacts.db');
mkdirSync(emailDir);
mkdirSync(calendarDir);
process.env.DATA_DIR = dir;
process.env.CONTACTS_DB_FILE = dbFile;
process.env.USER_EMAIL = '';
process.env.USER_NAME = '';
// Real parsers must never send test data to Hugging Face.
process.env.HF_API_KEY = '';
// Node stands in for fill_db: the "mbox" it is given is a script (below).
process.env.FILL_DB_BIN = process.execPath;
process.env.FILL_EVENTS_BIN = path.join(dir, 'no-fill_events');

const { config } = await import('../config.js');
const { initDatabase, getDatabase, hasDatabase } = await import('../db/index.js');
const { markContactNotHuman } = await import('../db/queries.js');
const { startImport, cancelImport, getImportStatus, currentSource } = await import('./importer.js');
const { isImporting } = await import('./state.js');
const { getSources } = await import('./sources.js');

const REPO = fileURLToPath(new URL('../../../../../../', import.meta.url));
const EXE = process.platform === 'win32' ? '.exe' : '';
const REAL_FILL_DB = path.join(REPO, 'gmail-mbox-parser', 'target', 'release', 'fill_db' + EXE);
const REAL_FILL_EVENTS = path.join(REPO, 'calendar-parser', 'target', 'release', 'fill_events' + EXE);
const FIXTURE = path.join(REPO, 'gmail-mbox-parser', 'tests', 'fixtures', 'sample.mbox');

// Stand-in parsers: Node runs these files as CommonJS whatever the extension.
writeFileSync(path.join(emailDir, 'fail.mbox'), `
  console.error('reading mbox');
  console.error('boom: not an mbox file');
  process.exit(3);
`);
writeFileSync(path.join(emailDir, 'hang.mbox'), `
  const db = process.argv[3];
  require('fs').writeFileSync(db, 'partial');
  console.error(JSON.stringify({ event: 'phase', phase: 'mails' }));
  console.error(JSON.stringify({ event: 'progress', phase: 'mails', bytes: 50, total_bytes: 100, messages: 1000 }));
  setInterval(() => {}, 1000);
`);

async function settle(): Promise<ImportStatus> {
  for (let i = 0; i < 600; i++) {
    const s = getImportStatus();
    if (s.state !== 'importing') return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('import did not finish within 30 s');
}

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(check(), 'condition not reached');
}

function rejects(action: () => unknown, status: number, pattern: RegExp) {
  assert.throws(action, (err: { status?: number; message: string }) => {
    assert.equal(err.status, status);
    assert.match(err.message, pattern);
    return true;
  });
}

function leftovers(): string[] {
  return readdirSync(dir).filter((f) => /\.(new|swap)/.test(f));
}

function count(sql: string): number {
  return Number(getDatabase().exec(sql)[0].values[0][0]);
}

try {
  await initDatabase();
  assert.deepEqual(getImportStatus(), { state: 'empty' });

  // 1. Requests rejected before anything starts.
  {
    rejects(() => startImport({ mbox: '../contacts.db', email: 'me@x.com' }), 400, /No file/);
    rejects(() => startImport({ mbox: 'missing.mbox', email: 'me@x.com' }), 400, /No file/);
    rejects(() => startImport({ mbox: 'fail.mbox', email: 'nobody' }), 400, /email/);
    rejects(() => startImport(null), 400, /No file/);
    rejects(() => cancelImport(), 409, /No import/);

    config.FILL_DB_BIN = path.join(dir, 'no-fill_db');
    rejects(() => startImport({ mbox: 'fail.mbox', email: 'me@x.com' }), 500, /make build-parser/);
    config.FILL_DB_BIN = process.execPath;
    assert.deepEqual(getImportStatus(), { state: 'empty' });
  }

  // 2. A parser that fails: its stderr explains why, nothing is left behind.
  {
    const s = startImport({ mbox: 'fail.mbox', email: ' Me@X.com ', includeCalendar: false });
    assert.equal(s.state, 'importing');
    assert.equal(isImporting(), true);
    const done = await settle();
    assert.equal(done.state, 'failed');
    if (done.state === 'failed') {
      assert.equal(done.error, 'boom: not an mbox file');
      assert.deepEqual(done.log, ['reading mbox', 'boom: not an mbox file']);
      assert.equal(done.hasData, false);
    }
    assert.equal(isImporting(), false);
    assert.equal(hasDatabase(), false);
    assert.deepEqual(leftovers(), []);
  }

  // 3. Cancel: the parser is stopped, then its output removed.
  {
    startImport({ mbox: 'hang.mbox', email: 'me@x.com' });
    await until(() => existsSync(dbFile + '.new'));
    await until(() => (getImportStatus() as { progress?: number }).progress === 0.425);

    // One import at a time.
    rejects(() => startImport({ mbox: 'fail.mbox', email: 'me@x.com' }), 409, /already running/);

    assert.equal(cancelImport().state, 'importing', 'still importing until the parser exits');
    const done = await settle();
    assert.equal(done.state, 'failed');
    if (done.state === 'failed') assert.equal(done.error, 'cancelled');
    assert.deepEqual(leftovers(), []);
  }

  if (!existsSync(REAL_FILL_DB)) {
    console.log(`importer.test: fill_db not built at ${REAL_FILL_DB}; skipping the real imports`);
  } else {
    config.FILL_DB_BIN = REAL_FILL_DB;
    copyFileSync(FIXTURE, path.join(emailDir, 'sample.mbox'));

    // 4. A real import becomes the working database.
    {
      startImport({ mbox: 'sample.mbox', email: 'You@Example.com', includeCalendar: true });
      const done = await settle();
      assert.equal(done.state, 'ready', JSON.stringify(done));
      if (done.state === 'ready') {
        assert.equal(done.userEmail, 'you@example.com');
        assert.equal(done.source, 'sample.mbox');
        const listed = getSources(currentSource()).mbox.find((f) => f.name === 'sample.mbox');
        assert.equal(listed?.current, true, 'the imported file is marked current');
        assert.ok(done.importedAt && Date.now() - done.importedAt < 60_000);
      }
      assert.equal(count(`SELECT COUNT(*) FROM contacts`), 12);
      assert.equal(count(`SELECT COUNT(*) FROM contacts_filtered`), 7);
      assert.ok(existsSync(dbFile));
      assert.equal(existsSync(dbFile + '.prev'), false, 'nothing to keep on the first import');
      assert.deepEqual(leftovers(), []);
      // No .ics files and no fill_events: the calendar is skipped, not an error.
      assert.equal(count(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'events'`), 0);
    }

    // 5. A failed import leaves the working data alone.
    {
      const before = readFileSync(dbFile);
      config.FILL_DB_BIN = process.execPath;
      startImport({ mbox: 'fail.mbox', email: 'you@example.com' });
      const done = await settle();
      assert.equal(done.state, 'failed');
      if (done.state === 'failed') assert.equal(done.hasData, true);
      assert.deepEqual(readFileSync(dbFile), before);
      assert.equal(count(`SELECT COUNT(*) FROM contacts`), 12);
      config.FILL_DB_BIN = REAL_FILL_DB;
    }

    // 6. Re-importing the same mailbox keeps a manual edit; the old file is kept.
    {
      markContactNotHuman('alice@example.com');
      startImport({ mbox: 'sample.mbox', email: 'you@example.com' });
      assert.equal((await settle()).state, 'ready');
      assert.equal(count(`SELECT COUNT(*) FROM contacts_filtered`), 6);
      assert.equal(count(`SELECT COUNT(*) FROM user_overrides WHERE email = 'alice@example.com'`), 1);
      assert.ok(existsSync(dbFile + '.prev'));
    }

    // 7. Another mailbox owner: the edit does not carry over.
    {
      startImport({ mbox: 'sample.mbox', email: 'someone-else@example.com' });
      assert.equal((await settle()).state, 'ready');
      assert.equal(count(`SELECT COUNT(*) FROM user_overrides`), 0);
    }

    // 8. With .ics files and fill_events built, the calendar is imported too.
    if (existsSync(REAL_FILL_EVENTS)) {
      config.FILL_EVENTS_BIN = REAL_FILL_EVENTS;
      writeFileSync(path.join(calendarDir, 'cal.ics'), 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n');
      startImport({ mbox: 'sample.mbox', email: 'you@example.com', includeCalendar: true });
      assert.equal((await settle()).state, 'ready');
      assert.equal(count(`SELECT COUNT(*) FROM sqlite_master WHERE name IN ('events', 'event_attendees')`), 2);

      // Unticked: no calendar tables in the new data.
      startImport({ mbox: 'sample.mbox', email: 'you@example.com', includeCalendar: false });
      assert.equal((await settle()).state, 'ready');
      assert.equal(count(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'events'`), 0);
    }
  }

  console.log('importer.test: all assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
