import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths relative to project root
const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const DATA_DIR = path.resolve(PROJECT_ROOT, '../data');

export const config = {
  // Database files - check data folder first, then project root
  CONTACTS_DB_FILE: process.env.CONTACTS_DB_FILE || path.join(DATA_DIR, 'contacts.db'),
  DEFAULT_DB_FILE: process.env.MAILS_DB_FILE || path.join(DATA_DIR, 'mails.db'),

  MY_EMAIL: (process.env.USER_EMAIL || '').toLowerCase(),

  // Server
  PORT: parseInt(process.env.PORT || '5000', 10),

  // Ranking coefficients
  RANKING_CONFIGS: [
    { name: 'sent', coefficient: 1.0 },
    { name: 'received', coefficient: 0.2 },
  ],
};
