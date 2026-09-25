import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Set before config.ts is loaded; the project .env never overrides these.
const dir = mkdtempSync(path.join(tmpdir(), 'gcg-app-'));
process.env.CONTACTS_DB_FILE = path.join(dir, 'contacts.db');
process.env.USER_EMAIL = 'env@example.com';
process.env.USER_NAME = '';

const { createApp } = await import('./app.js');
const { initDatabase, getDatabase, getSqlJs, swapDatabase } = await import('./db/index.js');
const { setMeta } = await import('./db/meta.js');
const { setImporting } = await import('./import/state.js');

await initDatabase();
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

/** A database shaped like fill_db's output, holding one filtered contact. */
async function mailbox(contact: string, userEmail: string | null) {
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE mails (id INTEGER PRIMARY KEY, "from" TEXT NOT NULL, from_name TEXT NOT NULL DEFAULT '',
      "to" TEXT NOT NULL, to_name TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '', date INTEGER);
    CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      received INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, sent_per_month REAL,
      received_per_month REAL, average_chars REAL, duration REAL,
      meetings INTEGER NOT NULL DEFAULT 0, not_spam INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE contacts_filtered (id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL UNIQUE,
      not_clear INTEGER NOT NULL DEFAULT 0);
  `);
  db.run(`INSERT INTO contacts (id, name, email, received, sent, not_spam) VALUES (1, 'X', ?, 3, 2, 1)`, [contact]);
  db.run(`INSERT INTO contacts_filtered (contact_id, not_clear) VALUES (1, 1)`);
  if (userEmail) {
    db.run(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    setMeta(db, 'user_email', userEmail);
  }
  return db;
}

function emails(graph: { nodes: { email: string }[] }): string[] {
  return graph.nodes.map((n) => n.email);
}

try {
  // 1. No database: health answers, data routes say the DB is empty.
  {
    assert.equal((await get('/api/health')).status, 200);
    for (const url of ['/api/graph', '/api/contacts', '/api/domains', '/api/message-groups', '/api/calendar-graph']) {
      const r = await get(url);
      assert.equal(r.status, 409, url);
      assert.deepEqual(r.body, { state: 'empty' }, url);
    }
    const edit = await post('/api/contacts/mark-clear', { email: 'a@x.com' });
    assert.equal(edit.status, 409);
  }

  // 2. After a swap the data routes serve the new database, with the email
  //    from its meta table as the centre node.
  {
    swapDatabase(await mailbox('alice@x.com', 'owner@x.com'));
    const r = await get('/api/graph');
    assert.equal(r.status, 200);
    assert.deepEqual(emails(r.body), ['owner@x.com', 'alice@x.com']);
    assert.equal(r.body.nodes[0].name, 'owner');
    assert.equal((await get('/api/message-groups')).status, 200);
  }

  // 3. A second swap drops the cached graph.
  {
    swapDatabase(await mailbox('bob@x.com', null));
    const r = await get('/api/graph');
    assert.deepEqual(emails(r.body), ['env@example.com', 'bob@x.com'], 'no meta: email from env');
    const contacts = await get('/api/contacts');
    assert.deepEqual(contacts.body.map((c: { email: string }) => c.email), ['bob@x.com']);
  }

  // 4. During an import reads go on, edits are refused.
  {
    setImporting(true);
    assert.equal((await get('/api/graph')).status, 200);
    for (const url of ['/api/contacts/mark-clear', '/api/contacts/mark-not-human', '/api/contacts/restore']) {
      const r = await post(url, { email: 'bob@x.com' });
      assert.equal(r.status, 409, url);
      assert.equal(r.body.state, 'importing', url);
    }
    setImporting(false);
    assert.equal((await post('/api/contacts/mark-clear', { email: 'bob@x.com' })).status, 200);
  }

  // 5. Edits are journaled, so a re-import can apply them again.
  {
    assert.equal((await post('/api/contacts/mark-not-human', { email: 'bob@x.com' })).status, 200);
    const rows = getDatabase().exec(`SELECT email, action FROM user_overrides`)[0].values;
    assert.deepEqual(rows, [['bob@x.com', 'not_human']], 'the last action replaces the earlier clear');

    // A failed restore (not a spam-filter survivor) is not journaled.
    assert.equal((await post('/api/contacts/restore', { email: 'nobody@x.com' })).status, 404);
    assert.equal(getDatabase().exec(`SELECT COUNT(*) FROM user_overrides`)[0].values[0][0], 1);
  }

  console.log('app.test: all assertions passed');
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
