import { config } from './config.js';
import { initDatabase } from './db/index.js';
import { createApp } from './app.js';

async function startServer() {
  const db = await initDatabase();
  console.log(db ? 'Database initialized' : `No database yet at ${config.CONTACTS_DB_FILE}; waiting for an import`);

  createApp().listen(config.PORT, config.HOST, () => {
    console.log(`Server running on http://${config.HOST}:${config.PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
