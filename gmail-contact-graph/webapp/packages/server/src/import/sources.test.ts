import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// config.ts reads the environment once, at import time.
const dir = mkdtempSync(path.join(tmpdir(), 'gcg-sources-'));
const email = path.join(dir, 'Email');
const calendar = path.join(dir, 'Calendar');
process.env.DATA_DIR = dir;
process.env.CONTACTS_DB_FILE = path.join(dir, 'contacts.db');
process.env.FILL_DB_BIN = path.join(dir, 'missing-fill_db');
process.env.FILL_EVENTS_BIN = process.execPath;
process.env.USER_EMAIL = 'Env@Example.com';
process.env.HF_API_KEY = '   ';

const { listMbox, resolveMbox, countIcs, getSources } = await import('./sources.js');

function file(p: string, content: string, mtimeSec: number) {
  writeFileSync(p, content);
  utimesSync(p, mtimeSec, mtimeSec);
}

try {
  // 1. A missing folder lists nothing instead of failing.
  assert.deepEqual(listMbox(), []);
  assert.equal(countIcs(), 0);

  mkdirSync(email);
  mkdirSync(calendar);
  file(path.join(email, 'old.mbox'), 'From a', 1_000_000);
  file(path.join(email, 'NEW.MBOX'), 'From bb', 2_000_000);
  file(path.join(email, '.upload-1.part.mbox'), 'hidden', 3_000_000);
  file(path.join(email, 'notes.txt'), 'x', 3_000_000);
  mkdirSync(path.join(email, 'folder.mbox'));
  file(path.join(calendar, 'a.ics'), '', 1);
  file(path.join(calendar, 'B.ICS'), '', 1);
  file(path.join(calendar, 'meet_settings.json'), '', 1);

  // 2. Only visible regular .mbox files, any case, newest first.
  {
    const list = listMbox();
    assert.deepEqual(list.map((f) => f.name), ['NEW.MBOX', 'old.mbox']);
    assert.equal(list[0].size, 7);
    assert.equal(list[0].modified, 2_000_000_000);
    assert.equal(countIcs(), 2);
  }

  // 3. Only an exact name from the listing resolves, to a path inside MBOX_DIR.
  {
    assert.equal(resolveMbox('old.mbox'), path.join(email, 'old.mbox'));
    for (const name of [
      '../contacts.db', path.join(email, 'old.mbox'), 'OLD.mbox', 'notes.txt',
      '.upload-1.part.mbox', 'folder.mbox', 'missing.mbox', '', 42, null, undefined, ['old.mbox'],
    ]) {
      assert.equal(resolveMbox(name), null, `accepted ${JSON.stringify(name)}`);
    }
  }

  // 4. The summary for the import screen.
  {
    const current = { name: 'old.mbox', size: 6, modified: 1_000_000_000 };
    const s = getSources(current);
    assert.equal(s.mboxDir, email);
    assert.equal(s.calendarDir, calendar);
    assert.deepEqual(s.mbox.map((f) => [f.name, f.current]), [['NEW.MBOX', false], ['old.mbox', true]]);
    assert.equal(s.icsCount, 2);
    assert.equal(s.parserAvailable, false);
    assert.equal(s.calendarParserAvailable, true);
    assert.equal(s.aiEnabled, false, 'a blank HF_API_KEY disables AI, as in fill_db');
    assert.equal(s.defaultEmail, 'env@example.com');

    // A file changed since the import is no longer the current one.
    const s2 = getSources({ ...current, size: 999 });
    assert.equal(s2.mbox.every((f) => !f.current), true);
  }

  console.log('sources.test: all assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
