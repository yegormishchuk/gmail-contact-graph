import { Router } from 'express';
import { getDatabase } from '../db/index.js';
import { getUserEmail } from '../db/meta.js';

const router = Router();

interface MessageRow {
  subject: string;
  from: string;
  to: string;
}

router.get('/message-groups', (req, res) => {
  try {
    const db = getDatabase();

    // Fetch all rows that share a (from, subject) pair where the user is involved.
    // The mails table stores one row per (from, to) pair, so a message sent to
    // N recipients produces N rows — only one of which has "to" = myEmail.
    // Joining on (from, subject) recovers all the other recipients.
    const myEmail = getUserEmail();
    const stmt = db.prepare(`
      SELECT m."from", m."to", m.subject
      FROM mails m
      INNER JOIN (
        SELECT DISTINCT "from", subject
        FROM mails
        WHERE ("from" = ? OR "to" = ?) AND subject != ''
      ) relevant ON m."from" = relevant."from" AND m.subject = relevant.subject
    `);
    stmt.bind([myEmail, myEmail]);

    const groups: Record<string, Set<string>> = {};

    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as MessageRow;
      if (!row.subject) continue;

      const subject = (row.subject as string).replace(/^(Re:|Fwd:)\s*/gi, '').trim();
      if (!subject) continue;

      if (!groups[subject]) {
        groups[subject] = new Set();
      }

      // Add both participants, excluding the user
      const sender = (row.from as string).trim().toLowerCase();
      const recipient = (row.to as string).trim().toLowerCase();
      if (sender && sender !== myEmail) groups[subject].add(sender);
      if (recipient && recipient !== myEmail) groups[subject].add(recipient);
    }
    stmt.free();

    // Filter to groups with 2+ unique recipients
    const filteredGroups = Object.fromEntries(
      Object.entries(groups)
        .filter(([_, members]) => members.size >= 2)
        .map(([subject, members]) => [subject, Array.from(members)])
    );

    res.json({
      total_groups: Object.keys(filteredGroups).length,
      groups: filteredGroups,
    });
  } catch (error) {
    console.error('Error loading message groups:', error);
    res.json({ total_groups: 0, groups: {} });
  }
});

export { router as groupsRouter };
