import { config } from './config.js';
import { initDatabase } from './db/index.js';
import { createApp } from './app.js';
import { stopParser } from './import/importer.js';

async function startServer() {
  const db = await initDatabase();
  console.log(db ? 'Database initialized' : `No database yet at ${config.CONTACTS_DB_FILE}; waiting for an import`);

  createApp().listen(config.PORT, config.HOST, () => {
    console.log(`Server running on http://${config.HOST}:${config.PORT}`);
  });
}

// Stop a running parser with the server, or it keeps writing contacts.db.new
// and holding it open. SIGBREAK is Ctrl+Break in a Windows console.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
  process.once(signal, () => {
    stopParser();
    // The handler is gone (once), so this ends the process the default way.
    process.kill(process.pid, signal);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
