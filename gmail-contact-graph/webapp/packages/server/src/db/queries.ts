import { getDatabase, saveDatabase } from './index.js';
import type { ContactFiltered, ExcludedContact } from '@gmail-graph/shared';

export interface DbContact {
  name: string;
  email: string;
  received: number;
  sent: number;
  not_clear: number;
}

export function loadContactsFromFiltered(): ContactFiltered[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT name, email, received, sent, not_clear
    FROM contacts_filtered
    ORDER BY (received + sent) DESC
  `);

  const results: ContactFiltered[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as DbContact;
    results.push({
      name: (row.name as string) || '',
      email: row.email as string,
      received_count: row.received as number,
      sent_count: row.sent as number,
      total_count: (row.received as number) + (row.sent as number),
      not_clear: row.not_clear === 1,
    });
  }
  stmt.free();

  return results;
}

export function loadExcludedContacts(): ExcludedContact[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT c.name, c.email, c.received, c.sent
    FROM contacts_candidates c
    LEFT JOIN contacts_filtered f ON c.email = f.email
    WHERE f.email IS NULL
    ORDER BY (c.received + c.sent) DESC
  `);

  const results: ExcludedContact[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as DbContact;
    results.push({
      name: (row.name as string) || '',
      email: row.email as string,
      received: row.received as number,
      sent: row.sent as number,
      total: (row.received as number) + (row.sent as number),
    });
  }
  stmt.free();

  return results;
}

export function markContactClear(email: string): void {
  const db = getDatabase();
  db.run('UPDATE contacts_filtered SET not_clear = 0 WHERE email = ?', [email]);
  saveDatabase();
}

export function markContactNotHuman(email: string): void {
  const db = getDatabase();
  db.run('DELETE FROM contacts_filtered WHERE email = ?', [email]);
  saveDatabase();
}

export function restoreContact(email: string): boolean {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT name, email, received, sent
    FROM contacts_candidates
    WHERE email = ?
  `);
  stmt.bind([email]);

  if (!stmt.step()) {
    stmt.free();
    return false;
  }

  const row = stmt.getAsObject() as unknown as DbContact;
  stmt.free();

  db.run(`
    INSERT OR REPLACE INTO contacts_filtered (name, email, received, sent, not_clear)
    VALUES (?, ?, ?, ?, 0)
  `, [row.name, row.email, row.received, row.sent]);

  saveDatabase();
  return true;
}

export function groupContactsByDomain(contacts: ContactFiltered[]): Record<string, ContactFiltered[]> {
  const personalDomains = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'mail.com', 'protonmail.com']);
  const groups: Record<string, ContactFiltered[]> = {};

  for (const contact of contacts) {
    const domain = contact.email.split('@')[1]?.toLowerCase();
    if (!domain || personalDomains.has(domain)) continue;

    if (!groups[domain]) groups[domain] = [];
    groups[domain].push(contact);
  }

  // Only keep domains with 2+ contacts
  return Object.fromEntries(
    Object.entries(groups).filter(([_, users]) => users.length >= 2)
  );
}
