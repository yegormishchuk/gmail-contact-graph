import type { RequestHandler } from 'express';
import { hasDatabase } from '../db/index.js';
import { isImporting } from '../import/state.js';

/** Data routes answer 409 until there is a database to read from. */
export const requireData: RequestHandler = (req, res, next) => {
  if (hasDatabase()) return next();
  res.status(409).json({ state: isImporting() ? 'importing' : 'empty' });
};

/** Edits are refused while an import runs, instead of being lost by it. */
export const requireIdle: RequestHandler = (req, res, next) => {
  if (!isImporting()) return next();
  res.status(409).json({ error: 'import in progress', state: 'importing' });
};
