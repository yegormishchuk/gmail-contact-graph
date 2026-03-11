import { Router } from 'express';
import initSqlJs from 'sql.js';
import { readFileSync, existsSync } from 'fs';
import { config } from '../config.js';

const router = Router();

interface MessageRow {
  subject: string;
  from: string;
  to: string;
}

router.get('/message-groups', async (req, res) => {
  if (!existsSync(config.CONTACTS_DB_FILE)) {
    return res.json({ total_groups: 0, groups: {} });
  }

  try {
    const SQL = await initSqlJs();
    const buffer = readFileSync(config.CONTACTS_DB_FILE);
    const db = new SQL.Database(buffer);

    // Fetch all rows where user is sender or recipient
    const stmt = db.prepare(`
      SELECT subject, "from", "to"
      FROM mails
      WHERE ("from" = ? OR "to" = ?) AND subject != ''
    `);
    const myEmail = config.MY_EMAIL.toLowerCase();
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
    db.close();

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
