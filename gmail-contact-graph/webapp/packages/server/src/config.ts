import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths relative to project root
const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const DATA_DIR = path.resolve(PROJECT_ROOT, '../data');

// Load the single project-root .env (one level up from PROJECT_ROOT, alongside
// the Rust parsers). Existing process.env values take precedence.
const ENV_FILE = path.resolve(PROJECT_ROOT, '../.env');
if (fs.existsSync(ENV_FILE)) {
  for (const rawLine of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

export const config = {
  // Database files - check data folder first, then project root
  CONTACTS_DB_FILE: process.env.CONTACTS_DB_FILE || path.join(DATA_DIR, 'contacts.db'),
  DEFAULT_DB_FILE: process.env.MAILS_DB_FILE || path.join(DATA_DIR, 'mails.db'),
  EVENTS_DB_FILE: process.env.EVENTS_DB_FILE || path.join(DATA_DIR, 'events.db'),

  MY_EMAIL: (process.env.USER_EMAIL || '').toLowerCase(),
  MY_NAME: process.env.USER_NAME || (process.env.USER_EMAIL || '').split('@')[0] || 'Me',

  // Server
  PORT: parseInt(process.env.PORT || '5000', 10),

  // Ranking coefficients
  RANKING_CONFIGS: [
    { name: 'sent', coefficient: 1.0 },
    { name: 'received', coefficient: 0.2 },
  ],
};
