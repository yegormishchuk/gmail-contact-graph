import { getDatabase, saveDatabase } from './index.js';
import { applyOverride, hasContact, recordOverride } from './overrides.js';
import type { ContactFiltered, ExcludedContact, Contact } from '@gmail-graph/shared';

export interface DbContact {
  name: string;
  email: string;
  received: number;
  sent: number;
  meetings: number;
  not_clear: number;
}

export type IntroContact = Pick<Contact, 'name' | 'email'>;

export function loadContactsFromFiltered(): ContactFiltered[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT c.name, c.email, c.received, c.sent, c.meetings, cf.not_clear
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
      meetings_count: row.meetings as number,
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

// Only addresses that are contacts are journaled, so a stray request cannot
// leave an edit behind to hit a matching contact in some later import.

export function markContactClear(email: string): void {
  const db = getDatabase();
  applyOverride(db, email, 'clear');
  if (hasContact(db, email)) recordOverride(db, email, 'clear');
  saveDatabase();
}

export function markContactNotHuman(email: string): void {
  const db = getDatabase();
  applyOverride(db, email, 'not_human');
  if (hasContact(db, email)) recordOverride(db, email, 'not_human');
  saveDatabase();
}

/** False when the contact did not pass the basic spam filter. */
export function restoreContact(email: string): boolean {
  const db = getDatabase();
  if (!applyOverride(db, email, 'restore')) return false;
  recordOverride(db, email, 'restore');
  saveDatabase();
  return true;
}

export function loadAllContacts(): { contacts: IntroContact[]; excludedEmails: string[] } {
  const db = getDatabase();

  const contactsStmt = db.prepare(`
    SELECT c.name, c.email
    FROM contacts c
    ORDER BY (c.received + c.sent) DESC
  `);
  const contacts: IntroContact[] = [];
  while (contactsStmt.step()) {
    const row = contactsStmt.getAsObject() as unknown as IntroContact;
    contacts.push({ name: row.name || '', email: row.email });
  }
  contactsStmt.free();

  const excludedStmt = db.prepare(`
    SELECT c.email
    FROM contacts c
    LEFT JOIN contacts_filtered cf ON cf.contact_id = c.id
    WHERE cf.contact_id IS NULL
  `);
  const excludedEmails: string[] = [];
  while (excludedStmt.step()) {
    const row = excludedStmt.getAsObject() as unknown as { email: string };
    excludedEmails.push(row.email);
  }
  excludedStmt.free();

  return { contacts, excludedEmails };
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
