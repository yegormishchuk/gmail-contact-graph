import { Router, type Response } from 'express';
import { config } from '../config.js';
import { getDemoReplay } from '../demo/boot.js';
import { rejectInDemo, requireJson } from '../middleware/guards.js';
import { cancelImport, currentSource, getImportStatus, ImportRequestError, startImport } from '../import/importer.js';
import { getSources } from '../import/sources.js';

// Mounted ahead of the data routes: all of these work without a database.
const router = Router();

router.get('/import/status', (req, res) => {
  res.json(config.DEMO_MODE ? { ...getImportStatus(), demo: true } : getImportStatus());
});

router.get('/import/sources', (req, res) => {
  res.json(getSources(currentSource()));
});

router.post('/import', rejectInDemo, requireJson, (req, res) => {
  respond(res, () => res.status(202).json(startImport(req.body)));
});

router.post('/import/cancel', rejectInDemo, requireJson, (req, res) => {
  respond(res, () => res.json(cancelImport()));
});

// The import every visitor's browser replays in the demo.
router.get('/demo/replay', (req, res) => {
  const replay = config.DEMO_MODE ? getDemoReplay() : null;
  if (!replay) return res.status(404).json({ error: 'Not a demo' });
  res.json(replay);
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
