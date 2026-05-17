import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, existsSync } from 'fs';
import { config } from '../config.js';

let eventsDb: SqlJsDatabase | null = null;

export async function initEventsDatabase(): Promise<SqlJsDatabase | null> {
  if (eventsDb) return eventsDb;

  if (!existsSync(config.EVENTS_DB_FILE)) {
    console.warn(`Events database not found at ${config.EVENTS_DB_FILE} — calendar endpoints will return empty payloads`);
    return null;
  }

  const SQL = await initSqlJs();
  const buffer = readFileSync(config.EVENTS_DB_FILE);
  eventsDb = new SQL.Database(buffer);
  console.log('Events database initialized');
  return eventsDb;
}

export function getEventsDatabase(): SqlJsDatabase | null {
  return eventsDb;
}
