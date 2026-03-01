import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initDatabase } from './db/index.js';
import { graphRouter } from './routes/graph.js';
import { contactsRouter } from './routes/contacts.js';
import { domainsRouter } from './routes/domains.js';
import { groupsRouter } from './routes/groups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  // Initialize database
  await initDatabase();
  console.log('Database initialized');

  const app = express();
  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api', graphRouter);
  app.use('/api', contactsRouter);
  app.use('/api', domainsRouter);
  app.use('/api', groupsRouter);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // In production, serve static files from client build
  if (process.env.NODE_ENV === 'production') {
    const clientDist = path.join(__dirname, '../../client/dist');
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.listen(config.PORT, () => {
    console.log(`Server running on http://localhost:${config.PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
