import type { CalendarGraphData, CalendarStats, EventGroups } from '@gmail-graph/shared';

// The demo server holds one database, imported with a calendar and no name.
// These make its answers match what a visitor's own import asked for.

/** The visitor's name on the centre node; '' keeps the server's. */
export function withCenterName<T extends { nodes: Array<{ isCenter: boolean; name: string }> }>(
  graph: T, name: string,
): T {
  if (!name) return graph;
  return { ...graph, nodes: graph.nodes.map((n) => (n.isCenter ? { ...n, name } : n)) };
}

// What the server answers for a database without calendar tables
// (db/calendarQueries.ts).

export function withoutCalendar(graph: CalendarGraphData): CalendarGraphData {
  return { ...graph, nodes: graph.nodes.filter((n) => n.isCenter) };
}

export const NO_CALENDAR_STATS: CalendarStats = {
  totalMeetings: 0,
  uniqueAttendees: 0,
  avgMeetingDurationSeconds: 0,
  topByScore: null,
  topByMeetings: null,
  topOrgByMeetings: null,
};

export const NO_EVENT_GROUPS: EventGroups = { total_groups: 0, groups: {} };
