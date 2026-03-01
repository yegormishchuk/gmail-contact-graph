import { Router } from 'express';
import initSqlJs from 'sql.js';
import { readFileSync, existsSync } from 'fs';
import { config } from '../config.js';

const router = Router();

interface MessageRow {
  subject: string;
  recipients: string;
}

router.get('/message-groups', async (req, res) => {
  // Check if mails database exists
  if (!existsSync(config.DEFAULT_DB_FILE)) {
    return res.json({ total_groups: 0, groups: {} });
  }

  try {
    const SQL = await initSqlJs();
    const buffer = readFileSync(config.DEFAULT_DB_FILE);
    const db = new SQL.Database(buffer);

    // Get messages with multiple recipients sent by user
    const stmt = db.prepare(`
      SELECT subject, recipients
      FROM emails
      WHERE sender LIKE ?
      AND recipients LIKE '%,%'
    `);
    stmt.bind([`%${config.MY_EMAIL}%`]);

    const groups: Record<string, string[]> = {};

    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as MessageRow;
      if (!row.subject || !row.recipients) continue;

      const recipients = (row.recipients as string)
        .split(',')
        .map(r => r.trim().toLowerCase())
        .filter(r => r && r !== config.MY_EMAIL.toLowerCase());

      if (recipients.length < 2) continue;

      const subject = (row.subject as string).replace(/^(Re:|Fwd:)\s*/gi, '').trim();
      if (!subject) continue;

      if (!groups[subject]) {
        groups[subject] = [];
      }

      for (const r of recipients) {
        if (!groups[subject].includes(r)) {
          groups[subject].push(r);
        }
      }
    }
    stmt.free();
    db.close();

    // Filter to groups with 2+ members
    const filteredGroups = Object.fromEntries(
      Object.entries(groups).filter(([_, members]) => members.length >= 2)
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
