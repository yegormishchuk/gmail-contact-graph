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
    SELECT c.name, c.email, c.received, c.sent, cf.not_clear
    FROM contacts_filtered cf
    JOIN contacts c ON c.id = cf.contact_id
    ORDER BY (c.received + c.sent) DESC
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
    FROM contacts c
    LEFT JOIN contacts_filtered cf ON cf.contact_id = c.id
    WHERE c.not_spam = 1 AND cf.contact_id IS NULL
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

export function loadSpamStats(): { excludedCount: number; excludedTotal: number } {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(c.received + c.sent), 0) as total
    FROM contacts c
    LEFT JOIN contacts_filtered cf ON cf.contact_id = c.id
    WHERE cf.contact_id IS NULL
  `);
  stmt.step();
  const row = stmt.getAsObject() as unknown as { count: number; total: number };
  stmt.free();
  return { excludedCount: row.count as number, excludedTotal: row.total as number };
}

export function markContactClear(email: string): void {
  const db = getDatabase();
  db.run('UPDATE contacts_filtered SET not_clear = 0 WHERE contact_id = (SELECT id FROM contacts WHERE email = ?)', [email]);
  saveDatabase();
}

export function markContactNotHuman(email: string): void {
  const db = getDatabase();
  db.run('DELETE FROM contacts_filtered WHERE contact_id = (SELECT id FROM contacts WHERE email = ?)', [email]);
  saveDatabase();
}

export function restoreContact(email: string): boolean {
  const db = getDatabase();

  const stmt = db.prepare(`
    SELECT id FROM contacts WHERE email = ? AND not_spam = 1
  `);
  stmt.bind([email]);

  if (!stmt.step()) {
    stmt.free();
    return false;
  }

  const row = stmt.getAsObject() as unknown as { id: number };
  stmt.free();

  db.run(`
    INSERT OR REPLACE INTO contacts_filtered (contact_id, not_clear) VALUES (?, 0)
  `, [row.id]);

  saveDatabase();
  return true;
}

export function loadAllContacts(): { contacts: { name: string; email: string }[]; spamEmails: string[] } {
  const db = getDatabase();

  const contactsStmt = db.prepare(`
    SELECT c.name, c.email
    FROM contacts c
    WHERE c.not_spam = 1
    ORDER BY (c.received + c.sent) DESC
  `);
  const contacts: { name: string; email: string }[] = [];
  while (contactsStmt.step()) {
    const row = contactsStmt.getAsObject() as unknown as { name: string; email: string };
    contacts.push({ name: row.name || '', email: row.email });
  }
  contactsStmt.free();

  const spamStmt = db.prepare(`
    SELECT c.email
    FROM contacts c
    LEFT JOIN contacts_filtered cf ON cf.contact_id = c.id
    WHERE c.not_spam = 1 AND cf.contact_id IS NULL
  `);
  const spamEmails: string[] = [];
  while (spamStmt.step()) {
    const row = spamStmt.getAsObject() as unknown as { email: string };
    spamEmails.push(row.email);
  }
  spamStmt.free();

  return { contacts, spamEmails };
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
