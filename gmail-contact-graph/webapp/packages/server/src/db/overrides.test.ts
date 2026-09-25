import assert from 'node:assert/strict';
import initSqlJs, { type Database } from 'sql.js';
import { ensureSchema } from './schema.js';
import { applyOverride, carryOverOverrides, recordOverride } from './overrides.js';

const SQL = await initSqlJs();

/**
 * A database shaped like fill_db's output. `contacts` maps email to
 * [not_spam, filtered], filtered being null (not in contacts_filtered) or its
 * not_clear flag.
 */
function mailbox(contacts: Record<string, [number, number | null]>, withSchema = true): Database {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL UNIQUE,
      received INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0,
      meetings INTEGER NOT NULL DEFAULT 0, not_spam INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE contacts_filtered (id INTEGER PRIMARY KEY, contact_id INTEGER NOT NULL UNIQUE,
      not_clear INTEGER NOT NULL DEFAULT 0);
  `);
  for (const [email, [notSpam, filtered]] of Object.entries(contacts)) {
    db.run(`INSERT INTO contacts (email, not_spam) VALUES (?, ?)`, [email, notSpam]);
    if (filtered !== null) {
      db.run(`INSERT INTO contacts_filtered (contact_id, not_clear) SELECT id, ? FROM contacts WHERE email = ?`,
        [filtered, email]);
    }
  }
  if (withSchema) ensureSchema(db);
  return db;
}

/** not_clear of `email` in contacts_filtered, or null when it is not there. */
function filtered(db: Database, email: string): number | null {
  const res = db.exec(
    `SELECT cf.not_clear FROM contacts_filtered cf JOIN contacts c ON c.id = cf.contact_id WHERE c.email = ?`,
    [email],
  );
  return res.length ? Number(res[0].values[0][0]) : null;
}

function journal(db: Database): Array<[string, string]> {
  const res = db.exec(`SELECT email, action FROM user_overrides ORDER BY email`);
  return res.length ? res[0].values.map((v) => [String(v[0]), String(v[1])] as [string, string]) : [];
}

// 1. Each action's effect on contacts_filtered.
{
  const db = mailbox({ 'a@x.com': [1, 1], 'b@x.com': [1, 0], 'c@x.com': [1, null], 'spam@x.com': [0, null] });
  assert.equal(applyOverride(db, 'a@x.com', 'clear'), true);
  assert.equal(filtered(db, 'a@x.com'), 0);

  assert.equal(applyOverride(db, 'b@x.com', 'not_human'), true);
  assert.equal(filtered(db, 'b@x.com'), null);

  assert.equal(applyOverride(db, 'c@x.com', 'restore'), true);
  assert.equal(filtered(db, 'c@x.com'), 0);

  // Only a contact that passed the basic spam filter can be restored.
  assert.equal(applyOverride(db, 'spam@x.com', 'restore'), false);
  assert.equal(filtered(db, 'spam@x.com'), null);
}

// 2. The journal keeps the last action per email, lowercased.
{
  const db = mailbox({});
  recordOverride(db, ' A@X.com ', 'restore', 1);
  recordOverride(db, 'a@x.com', 'clear', 2);
  recordOverride(db, 'b@x.com', 'not_human', 3);
  assert.deepEqual(journal(db), [['a@x.com', 'clear'], ['b@x.com', 'not_human']]);
}

// 3. Same mailbox: the whole journal is copied and applied to the new data.
{
  const old = mailbox({});
  recordOverride(old, 'a@x.com', 'clear');
  recordOverride(old, 'b@x.com', 'not_human');
  recordOverride(old, 'c@x.com', 'restore');
  recordOverride(old, 'gone@x.com', 'not_human');

  const next = mailbox({ 'a@x.com': [1, 1], 'b@x.com': [1, 1], 'c@x.com': [1, null] });
  const result = carryOverOverrides(old, next, 'Me@X.com', 'me@x.com');

  assert.deepEqual(result, { copied: 4, applied: 3 });
  assert.equal(filtered(next, 'a@x.com'), 0);
  assert.equal(filtered(next, 'b@x.com'), null);
  assert.equal(filtered(next, 'c@x.com'), 0);
  // Kept although it had no effect: the contact may come back next time.
  assert.deepEqual(journal(next).map(([e]) => e), ['a@x.com', 'b@x.com', 'c@x.com', 'gone@x.com']);
}

// 4. Another mailbox: nothing is carried over.
{
  const old = mailbox({});
  recordOverride(old, 'a@x.com', 'not_human');
  const next = mailbox({ 'a@x.com': [1, 1] });
  assert.deepEqual(carryOverOverrides(old, next, 'me@x.com', 'other@x.com'), { copied: 0, applied: 0 });
  assert.equal(filtered(next, 'a@x.com'), 1);
  assert.deepEqual(journal(next), []);

  // An unknown owner on either side counts as a different mailbox.
  assert.deepEqual(carryOverOverrides(old, next, '', ''), { copied: 0, applied: 0 });
}

// 5. A database from before the journal existed has nothing to carry.
{
  const old = mailbox({ 'a@x.com': [1, 1] }, false);
  const next = mailbox({ 'a@x.com': [1, 1] });
  assert.deepEqual(carryOverOverrides(old, next, 'me@x.com', 'me@x.com'), { copied: 0, applied: 0 });
}

// 6. Journal emails match contacts regardless of case.
{
  const old = mailbox({});
  old.run(`INSERT INTO user_overrides (email, action, updated_at) VALUES ('Mixed@X.com', 'not_human', 1)`);
  const next = mailbox({ 'mixed@x.com': [1, 1] });
  assert.deepEqual(carryOverOverrides(old, next, 'me@x.com', 'me@x.com'), { copied: 1, applied: 1 });
  assert.equal(filtered(next, 'mixed@x.com'), null);
}

console.log('overrides.test: all assertions passed');
