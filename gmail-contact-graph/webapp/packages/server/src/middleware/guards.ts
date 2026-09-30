import type { RequestHandler } from 'express';
import { hasDatabase } from '../db/index.js';
import { isImporting } from '../import/state.js';

/** Data routes answer 409 until there is a database to read from. */
export const requireData: RequestHandler = (req, res, next) => {
  if (hasDatabase()) return next();
  res.status(409).json({ state: isImporting() ? 'importing' : 'empty' });
};

/**
 * POSTs that change state must be sent as JSON. The server listens on
 * loopback, but any page open in the browser can send a request to it; a
 * cross-origin request with this content type needs a CORS preflight, which
 * the server does not answer, so the browser never sends it.
 *
 * Checks the header itself rather than req.is(), which returns null for a
 * request without a body.
 */
export const requireJson: RequestHandler = (req, res, next) => {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json') return next();
  res.status(415).json({ error: 'Content-Type must be application/json' });
};

/** Edits are refused while an import runs, instead of being lost by it. */
export const requireIdle: RequestHandler = (req, res, next) => {
  if (!isImporting()) return next();
  res.status(409).json({ error: 'import in progress', state: 'importing' });
};
