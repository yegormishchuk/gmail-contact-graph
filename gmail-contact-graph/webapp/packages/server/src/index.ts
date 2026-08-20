import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initDatabase } from './db/index.js';
import { graphRouter } from './routes/graph.js';
import { contactsRouter } from './routes/contacts.js';
import { domainsRouter } from './routes/domains.js';
import { groupsRouter } from './routes/groups.js';
import { calendarRouter } from './routes/calendar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  // Initialize database
  await initDatabase();
  console.log('Database initialized');

  const app = express();
  if (config.ALLOWED_ORIGINS.length > 0) {
    app.use(cors({ origin: config.ALLOWED_ORIGINS }));
  }
  app.use(express.json());

  // API routes
  app.use('/api', graphRouter);
  app.use('/api', contactsRouter);
  app.use('/api', domainsRouter);
  app.use('/api', groupsRouter);
  app.use('/api', calendarRouter);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Serve static files from client build when available (production start)
  const clientDist = path.join(__dirname, '../../client/dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.listen(config.PORT, config.HOST, () => {
    console.log(`Server running on http://${config.HOST}:${config.PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
