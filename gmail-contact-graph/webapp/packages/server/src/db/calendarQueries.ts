import { getEventsDatabase } from './events.js';
import { config } from '../config.js';
import type { CalendarGraphData, CalendarNode, CalendarStats } from '@gmail-graph/shared';

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'aol.com', 'mail.com', 'protonmail.com',
]);

export function loadCalendarGraph(): CalendarGraphData {
  const db = getEventsDatabase();
  const userEmail = config.MY_EMAIL;

  const centerNode: CalendarNode = {
    id: 'me',
    name: config.MY_NAME,
    email: userEmail,
    isCenter: true,
    totalEvents: 0,
    avgDurationSeconds: null,
    avgAttendees: null,
    acceptanceRate: null,
    calendarScore: 999999999,
  };

  if (!db) {
    return { nodes: [centerNode], userEmail };
  }

  const stmt = db.prepare(`
    SELECT
      email, name, total_events_count, avg_duration_seconds,
      avg_attendee_count, acceptance_rate,
      (avg_duration_seconds / avg_attendee_count) * total_events_count AS score
    FROM event_attendees
    WHERE avg_duration_seconds IS NOT NULL
      AND avg_attendee_count IS NOT NULL
      AND avg_attendee_count > 0
      AND total_events_count > 0
    ORDER BY score DESC
  `);

  const nodes: CalendarNode[] = [centerNode];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as {
      email: string;
      name: string;
      total_events_count: number;
      avg_duration_seconds: number;
      avg_attendee_count: number;
      acceptance_rate: number | null;
      score: number;
    };
    nodes.push({
      id: row.email,
      name: row.name || row.email.split('@')[0],
      email: row.email,
      isCenter: false,
      totalEvents: row.total_events_count,
      avgDurationSeconds: row.avg_duration_seconds,
      avgAttendees: row.avg_attendee_count,
      acceptanceRate: row.acceptance_rate ?? null,
      calendarScore: row.score,
    });
  }
  stmt.free();

  return { nodes, userEmail };
}

export function loadCalendarStats(): CalendarStats {
  const db = getEventsDatabase();
  const empty: CalendarStats = {
    totalMeetings: 0,
    uniqueAttendees: 0,
    avgMeetingDurationSeconds: 0,
    topByScore: null,
    topByMeetings: null,
    topOrgByMeetings: null,
  };

  if (!db) return empty;

  // Totals: events count + average duration over events with both timestamps
  let totalMeetings = 0;
  let avgDuration = 0;
  {
    const stmt = db.prepare(`
      SELECT COUNT(*) AS n,
             COALESCE(AVG(CAST(dtend - dtstart AS REAL)), 0) AS avg_dur
      FROM events
      WHERE dtstart IS NOT NULL AND dtend IS NOT NULL
    `);
    stmt.step();
    const row = stmt.getAsObject() as unknown as { n: number; avg_dur: number };
    totalMeetings = row.n;
    avgDuration = row.avg_dur;
    stmt.free();
  }

  // Unique attendees
  let uniqueAttendees = 0;
  {
    const stmt = db.prepare(`SELECT COUNT(*) AS n FROM event_attendees`);
    stmt.step();
    uniqueAttendees = (stmt.getAsObject() as unknown as { n: number }).n;
    stmt.free();
  }

  // Top by calendar score
  let topByScore: CalendarStats['topByScore'] = null;
  {
    const stmt = db.prepare(`
      SELECT email, name,
        (avg_duration_seconds / avg_attendee_count) * total_events_count AS score
      FROM event_attendees
      WHERE avg_duration_seconds IS NOT NULL
        AND avg_attendee_count IS NOT NULL
        AND avg_attendee_count > 0
        AND total_events_count > 0
      ORDER BY score DESC
      LIMIT 1
    `);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as { email: string; name: string; score: number };
      topByScore = {
        name: row.name || row.email.split('@')[0],
        email: row.email,
        score: row.score,
      };
    }
    stmt.free();
  }

  // Top by meetings count
  let topByMeetings: CalendarStats['topByMeetings'] = null;
  {
    const stmt = db.prepare(`
      SELECT email, name, total_events_count AS meetings
      FROM event_attendees
      WHERE total_events_count > 0
      ORDER BY total_events_count DESC
      LIMIT 1
    `);
    if (stmt.step()) {
      const row = stmt.getAsObject() as unknown as { email: string; name: string; meetings: number };
      topByMeetings = {
        name: row.name || row.email.split('@')[0],
        email: row.email,
        meetings: row.meetings,
      };
    }
    stmt.free();
  }

  // Top org by meetings (aggregate by attendee email domain, excluding personal domains)
  let topOrgByMeetings: CalendarStats['topOrgByMeetings'] = null;
  {
    const domainTotals = new Map<string, number>();
    const stmt = db.prepare(`SELECT email, total_events_count FROM event_attendees`);
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as { email: string; total_events_count: number };
      const domain = row.email.split('@')[1]?.toLowerCase();
      if (!domain || PERSONAL_DOMAINS.has(domain)) continue;
      domainTotals.set(domain, (domainTotals.get(domain) ?? 0) + row.total_events_count);
    }
    stmt.free();

    let bestDomain: string | null = null;
    let bestCount = 0;
    for (const [domain, count] of domainTotals) {
      if (count > bestCount) {
        bestCount = count;
        bestDomain = domain;
      }
    }
    if (bestDomain !== null) {
      topOrgByMeetings = { domain: bestDomain, meetings: bestCount };
    }
  }

  return {
    totalMeetings,
    uniqueAttendees,
    avgMeetingDurationSeconds: avgDuration,
    topByScore,
    topByMeetings,
    topOrgByMeetings,
  };
}
