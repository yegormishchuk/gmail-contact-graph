import { Router } from 'express';
import { loadCalendarGraph, loadCalendarStats } from '../db/calendarQueries.js';

const router = Router();

// Cache (calendar data is read-only at runtime)
let graphCache: ReturnType<typeof loadCalendarGraph> | null = null;
let statsCache: ReturnType<typeof loadCalendarStats> | null = null;

router.get('/calendar-graph', (req, res) => {
  if (!graphCache) graphCache = loadCalendarGraph();
  res.json(graphCache);
});

router.get('/calendar-stats', (req, res) => {
  if (!statsCache) statsCache = loadCalendarStats();
  res.json(statsCache);
});

export { router as calendarRouter };
