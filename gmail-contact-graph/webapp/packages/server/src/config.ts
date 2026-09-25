import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths relative to project root
const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

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

// Relative values resolve against PROJECT_ROOT (the gmail-contact-graph
// directory), which is where `make run` is invoked from; see CONTACTS_DB_FILE.
const DATA_DIR = path.resolve(PROJECT_ROOT, process.env.DATA_DIR || '../data');
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..');
const EXE = process.platform === 'win32' ? '.exe' : '';

function fromEnvPath(name: string, fallback: string): string {
  const value = process.env[name];
  return value ? path.resolve(PROJECT_ROOT, value) : fallback;
}

export const config = {
  DATA_DIR,

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

  // Where the import screen lists sources from (same defaults as the Makefiles).
  MBOX_DIR: fromEnvPath('MBOX_DIR', path.join(DATA_DIR, 'Email')),
  CALENDAR_DIR: fromEnvPath('CALENDAR_DIR', path.join(DATA_DIR, 'Calendar')),

  // The parsers the server runs for an import: built in place by `make build`
  // natively, installed in /usr/local/bin in the Docker image.
  FILL_DB_BIN: fromEnvPath('FILL_DB_BIN', path.join(REPO_ROOT, 'gmail-mbox-parser', 'target', 'release', 'fill_db' + EXE)),
  FILL_EVENTS_BIN: fromEnvPath('FILL_EVENTS_BIN', path.join(REPO_ROOT, 'calendar-parser', 'target', 'release', 'fill_events' + EXE)),

  // Fallbacks for databases without a meta table; use getUserEmail() and
  // getUserName() from db/meta.ts, which prefer the email the import recorded.
  ENV_USER_EMAIL: (process.env.USER_EMAIL || '').trim().toLowerCase(),
  ENV_USER_NAME: (process.env.USER_NAME || '').trim(),
  // As written, not lowercased: 'John.Doe@…' names the centre node 'John.Doe'.
  ENV_USER_EMAIL_LOCAL: (process.env.USER_EMAIL || '').trim().split('@')[0],

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
