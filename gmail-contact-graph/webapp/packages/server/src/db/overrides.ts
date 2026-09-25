import type { Database as SqlJsDatabase } from 'sql.js';

/**
 * Manual edits to the filtered contact list, journaled in user_overrides.
 *
 * fill_db rebuilds contacts_filtered on every run, so an edit applied only to
 * that table would be lost by the next import. The journal records what the
 * user asked for; an import of the same mailbox copies it into the new
 * database and applies it again. One row per email: the last action wins.
 */
export type OverrideAction = 'clear' | 'not_human' | 'restore';

const CONTACT_ID = `(SELECT id FROM contacts WHERE email = ?)`;

/**
 * Applies `action` to contacts_filtered. Returns whether it changed anything:
 * false for a contact that is missing or already clear / already excluded.
 * A restore returns false only for a contact that did not pass the basic spam
 * filter (the restore endpoint answers 404 for it), and true otherwise.
 */
export function applyOverride(db: SqlJsDatabase, email: string, action: OverrideAction): boolean {
  const key = normalize(email);
  switch (action) {
    case 'clear':
      db.run(`UPDATE contacts_filtered SET not_clear = 0 WHERE contact_id = ${CONTACT_ID} AND not_clear != 0`, [key]);
      return db.getRowsModified() > 0;
    case 'not_human':
      db.run(`DELETE FROM contacts_filtered WHERE contact_id = ${CONTACT_ID}`, [key]);
      return db.getRowsModified() > 0;
    case 'restore': {
      const res = db.exec(`SELECT id FROM contacts WHERE email = ? AND not_spam = 1`, [key]);
      if (!res.length) return false;
      db.run(`INSERT OR REPLACE INTO contacts_filtered (contact_id, not_clear) VALUES (?, 0)`, [res[0].values[0][0]]);
      return true;
    }
  }
}

export function recordOverride(
  db: SqlJsDatabase,
  email: string,
  action: OverrideAction,
  now: number = Date.now(),
): void {
  db.run(
    `INSERT OR REPLACE INTO user_overrides (email, action, updated_at) VALUES (?, ?, ?)`,
    [normalize(email), action, now],
  );
}

/**
 * Copies the journal of `from` into `to` and applies every row to `to`, if
 * both databases belong to the same mailbox. Rows whose contact is missing
 * from `to` are copied anyway: the contact may be back after the next import.
 *
 * `to` must already have the user_overrides table (ensureSchema).
 */
export function carryOverOverrides(
  from: SqlJsDatabase,
  to: SqlJsDatabase,
  fromEmail: string,
  toEmail: string,
): { copied: number; applied: number } {
  const none = { copied: 0, applied: 0 };
  if (!normalize(fromEmail) || normalize(fromEmail) !== normalize(toEmail)) return none;

  const hasJournal = from.exec(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_overrides'`,
  ).length > 0;
  if (!hasJournal) return none;

  const res = from.exec(`SELECT email, action, updated_at FROM user_overrides`);
  const rows = res.length ? res[0].values : [];

  let applied = 0;
  for (const [email, action, updatedAt] of rows) {
    const key = String(email);
    const act = action as OverrideAction;
    recordOverride(to, key, act, Number(updatedAt));
    if (applyOverride(to, key, act)) applied++;
  }
  return { copied: rows.length, applied };
}

export function hasContact(db: SqlJsDatabase, email: string): boolean {
  return db.exec(`SELECT 1 FROM contacts WHERE email = ?`, [normalize(email)]).length > 0;
}

// fill_db stores every address trimmed and lowercased.
function normalize(email: string): string {
  return email.trim().toLowerCase();
}
