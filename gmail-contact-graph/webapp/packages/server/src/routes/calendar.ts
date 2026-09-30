import { Router } from 'express';
import { loadCalendarGraph, loadCalendarStats, loadEventGroups } from '../db/calendarQueries.js';
import { onDatabaseReload } from '../db/index.js';

const router = Router();

// Cache (calendar data only changes when an import swaps the database)
let graphCache: ReturnType<typeof loadCalendarGraph> | null = null;
let statsCache: ReturnType<typeof loadCalendarStats> | null = null;
let eventGroupsCache: ReturnType<typeof loadEventGroups> | null = null;

onDatabaseReload(() => {
  graphCache = null;
  statsCache = null;
  eventGroupsCache = null;
});

router.get('/calendar-graph', (req, res) => {
  if (!graphCache) graphCache = loadCalendarGraph();
  res.json(graphCache);
});

router.get('/calendar-stats', (req, res) => {
  if (!statsCache) statsCache = loadCalendarStats();
  res.json(statsCache);
});

router.get('/event-groups', (req, res) => {
  if (!eventGroupsCache) eventGroupsCache = loadEventGroups();
  res.json(eventGroupsCache);
});

export { router as calendarRouter };
