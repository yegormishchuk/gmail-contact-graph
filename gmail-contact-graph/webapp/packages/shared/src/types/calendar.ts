export interface CalendarNode {
  id: string;
  name: string;
  email: string;
  isCenter: boolean;
  totalEvents: number;
  organizedEvents: number;
  avgDurationSeconds: number | null;
  avgAttendees: number | null;
  acceptanceRate: number | null;
  calendarScore: number;
  // D3 simulation properties (added at runtime)
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface CalendarGraphData {
  nodes: CalendarNode[];
  userEmail: string;
}

export interface CalendarStats {
  totalMeetings: number;
  uniqueAttendees: number;
  avgMeetingDurationSeconds: number;
  topByScore: { name: string; email: string; score: number } | null;
  topByMeetings: { name: string; email: string; meetings: number } | null;
  topOrgByMeetings: { domain: string; meetings: number } | null;
}

export interface EventGroups {
  total_groups: number;
  groups: Record<string, string[]>; // event label -> attendee emails
}
