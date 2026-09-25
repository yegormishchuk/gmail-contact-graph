import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { requireData } from './middleware/guards.js';
import { graphRouter } from './routes/graph.js';
import { contactsRouter } from './routes/contacts.js';
import { domainsRouter } from './routes/domains.js';
import { groupsRouter } from './routes/groups.js';
import { calendarRouter } from './routes/calendar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): express.Express {
  const app = express();
  if (config.ALLOWED_ORIGINS.length > 0) {
    app.use(cors({ origin: config.ALLOWED_ORIGINS }));
  }
  app.use(express.json());

  // Health check. Registered ahead of the data routes, whose guard would
  // answer 409 for it while there is no database.
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Data routes: every one of them needs a database. requireData runs for
  // every /api path that reaches this router, matched or not, so routes that
  // must work without a database (health, import) are registered above it.
  const data = express.Router();
  data.use(requireData);
  data.use(graphRouter);
  data.use(contactsRouter);
  data.use(domainsRouter);
  data.use(groupsRouter);
  data.use(calendarRouter);
  app.use('/api', data);

  // Serve static files from client build when available (production start)
  const clientDist = path.join(__dirname, '../../client/dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}
