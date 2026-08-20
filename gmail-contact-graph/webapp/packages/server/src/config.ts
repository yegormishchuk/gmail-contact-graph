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
  // The parsers write every table — contacts, mails, events, event_attendees —
  // into this one file.
  //
  // A relative CONTACTS_DB_FILE is resolved against the gmail-contact-graph
  // directory, which is where `make run` is invoked from. Leaving it to the
  // process working directory would resolve it against packages/server, since
  // that is where npm runs the start script.
  CONTACTS_DB_FILE: process.env.CONTACTS_DB_FILE
    ? path.resolve(PROJECT_ROOT, process.env.CONTACTS_DB_FILE)
    : path.join(DATA_DIR, 'contacts.db'),

  MY_EMAIL: (process.env.USER_EMAIL || '').toLowerCase(),
  MY_NAME: process.env.USER_NAME || (process.env.USER_EMAIL || '').split('@')[0] || 'Me',

  // Server
  PORT: parseInt(process.env.PORT || '5000', 10),

  // Loopback by default. The database behind this server is your whole mailbox,
  // so binding 0.0.0.0 would hand it to everyone on the same network — set HOST
  // explicitly (e.g. in a container) if you really want that.
  HOST: process.env.HOST || '127.0.0.1',

  // The client is served from this same origin in production and reaches the
  // API through the Vite proxy in development, so no CORS headers are needed.
  // Sending them anyway would let any page open in your browser read the graph
  // off localhost. Set ALLOWED_ORIGINS only for a deliberate cross-origin setup.
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // Ranking coefficients
  RANKING_CONFIGS: [
    { name: 'sent', coefficient: 1.0 },
    { name: 'received', coefficient: 0.2 },
  ],
};
