import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// config.ts reads the environment once, at import time, and the project .env
// never overrides a variable that is already set. Everything below therefore
// has to be in place before the modules under test are loaded.
const dir = mkdtempSync(path.join(tmpdir(), 'gcg-swap-'));
const dbFile = path.join(dir, 'contacts.db');
process.env.CONTACTS_DB_FILE = dbFile;
process.env.USER_EMAIL = 'Env@Example.com';
process.env.USER_NAME = '';

const {
  initDatabase, hasDatabase, getDatabase, getSqlJs, swapDatabase, onDatabaseReload,
  recoverDataFiles, _testing,
} = await import('./index.js');
const { getMeta, setMeta, getUserEmail, getUserName } = await import('./meta.js');

function tables(db: ReturnType<typeof getDatabase>): string[] {
  const res = db.exec(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  return res.length ? res[0].values.map((v) => String(v[0])) : [];
}

async function newDb(marker: string) {
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE contacts (id INTEGER PRIMARY KEY, email TEXT, marker TEXT)`);
  db.run(`INSERT INTO contacts (email, marker) VALUES ('a@x.com', ?)`, [marker]);
  return db;
}

function markerOnDisk(SQL: Awaited<ReturnType<typeof getSqlJs>>, file: string): string {
  const db = new SQL.Database(readFileSync(file));
  const v = String(db.exec(`SELECT marker FROM contacts`)[0].values[0][0]);
  db.close();
  return v;
}

try {
  // 1. Leftovers of an interrupted import are removed; the working file stays.
  {
    const sub = path.join(dir, 'recover1');
    mkdirSync(sub);
    const f = path.join(sub, 'contacts.db');
    for (const suffix of ['', '.new', '.new-wal', '.new-shm', '.swap', '.prev']) {
      writeFileSync(f + suffix, suffix || 'main');
    }
    recoverDataFiles(f);
    assert.equal(readFileSync(f, 'utf8'), 'main');
    for (const suffix of ['.new', '.new-wal', '.new-shm', '.swap']) {
      assert.equal(existsSync(f + suffix), false, `${suffix} was not removed`);
    }
    assert.equal(readFileSync(f + '.prev', 'utf8'), '.prev', '.prev must be kept');
  }

  // 2. A swap interrupted between its two renames leaves only .prev: restore it.
  {
    const sub = path.join(dir, 'recover2');
    mkdirSync(sub);
    const f = path.join(sub, 'contacts.db');
    writeFileSync(f + '.prev', 'previous');
    writeFileSync(f + '.swap', 'half-written');
    recoverDataFiles(f);
    assert.equal(readFileSync(f, 'utf8'), 'previous');
    assert.equal(existsSync(f + '.prev'), false);
    assert.equal(existsSync(f + '.swap'), false);
  }

  // 3. No database file: the server starts empty instead of throwing.
  {
    const db = await initDatabase();
    assert.equal(db, null);
    assert.equal(hasDatabase(), false);
    assert.throws(() => getDatabase(), /not initialized|no database/i);
    assert.equal(getUserEmail(), 'env@example.com', 'env email is lowercased');
    assert.equal(getUserName(), 'env');
  }

  // 4. The first swap writes the file, ensures the schema and notifies.
  let reloads = 0;
  onDatabaseReload(() => { reloads++; });
  const SQL = await getSqlJs();
  {
    const first = await newDb('first');
    swapDatabase(first);
    assert.equal(hasDatabase(), true);
    assert.equal(getDatabase(), first);
    assert.equal(reloads, 1);
    assert.equal(markerOnDisk(SQL, dbFile), 'first');
    assert.equal(existsSync(dbFile + '.prev'), false, 'nothing to keep on the first swap');
    assert.equal(existsSync(dbFile + '.swap'), false);
    for (const t of ['contacts_filtered', 'meta']) {
      assert.ok(tables(first).includes(t), `${t} was not created`);
    }
  }

  // 5. meta.user_email wins over the environment.
  {
    setMeta(getDatabase(), 'user_email', 'meta@example.com');
    assert.equal(getMeta(getDatabase(), 'user_email'), 'meta@example.com');
    assert.equal(getMeta(getDatabase(), 'missing'), null);
    assert.equal(getUserEmail(), 'meta@example.com');
    assert.equal(getUserName(), 'meta');
  }

  // 6. A second swap keeps the previous file as .prev.
  {
    const second = await newDb('second');
    swapDatabase(second);
    assert.equal(getDatabase(), second);
    assert.equal(reloads, 2);
    assert.equal(markerOnDisk(SQL, dbFile), 'second');
    assert.equal(markerOnDisk(SQL, dbFile + '.prev'), 'first');
    assert.equal(getUserEmail(), 'env@example.com', 'the new DB has no meta yet');
  }

  // 7. Renaming the new file into place keeps failing: the previous file is
  //    put back, the in-memory DB is untouched and the caller sees the error.
  {
    const current = getDatabase();
    let attempts = 0;
    _testing.setRename((from, to) => {
      if (from === dbFile + '.swap') {
        attempts++;
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      }
      return _testing.realRename(from, to);
    });
    try {
      assert.throws(() => swapDatabase(new SQL.Database()), /busy/);
    } finally {
      _testing.setRename(_testing.realRename);
    }
    assert.equal(attempts, 5, 'EBUSY is retried five times');
    assert.equal(getDatabase(), current);
    assert.equal(reloads, 2, 'a failed swap does not notify');
    assert.equal(markerOnDisk(SQL, dbFile), 'second');
    assert.equal(existsSync(dbFile + '.swap'), false);
  }

  // 8. Opening an existing file ensures the schema, like the swap does.
  {
    const sub = path.join(dir, 'schema');
    mkdirSync(sub);
    const f = path.join(sub, 'contacts.db');
    const bare = new SQL.Database();
    bare.run(`CREATE TABLE contacts (id INTEGER PRIMARY KEY)`);
    writeFileSync(f, Buffer.from(bare.export()));
    const opened = _testing.openFile(SQL, f);
    for (const t of ['contacts_filtered', 'meta']) {
      assert.ok(tables(opened).includes(t), `${t} was not created`);
    }
  }

  console.log('swap.test: all assertions passed');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
