import { Router, type Response } from 'express';
import { requireJson } from '../middleware/guards.js';
import { cancelImport, currentSource, getImportStatus, ImportRequestError, startImport } from '../import/importer.js';
import { getSources } from '../import/sources.js';

// Mounted ahead of the data routes: all of these work without a database.
const router = Router();

router.get('/import/status', (req, res) => {
  res.json(getImportStatus());
});

router.get('/import/sources', (req, res) => {
  res.json(getSources(currentSource()));
});

router.post('/import', requireJson, (req, res) => {
  respond(res, () => res.status(202).json(startImport(req.body)));
});

router.post('/import/cancel', requireJson, (req, res) => {
  respond(res, () => res.json(cancelImport()));
});

function respond(res: Response, action: () => void) {
  try {
    action();
  } catch (err) {
    if (!(err instanceof ImportRequestError)) throw err;
    res.status(err.status).json({ error: err.message, status: getImportStatus() });
  }
}

export { router as importRouter };
