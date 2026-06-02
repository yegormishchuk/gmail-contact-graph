import type { GraphData, GraphNode, GraphLink, CalendarGraphData } from '@gmail-graph/shared';

const TOP_N = 150;
const FIRST_PLACE_POINTS = 300;
const STEP = 2;
const CALENDAR_WEIGHT = 0.5;

function bordaPoints(rank: number): number {
  if (rank < 1 || rank > TOP_N) return 0;
  return FIRST_PLACE_POINTS - STEP * (rank - 1);
}

function assignPoints(
  entries: { email: string; score: number }[],
): Map<string, { rank: number; points: number }> {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const out = new Map<string, { rank: number; points: number }>();
  sorted.forEach((e, i) => {
    const rank = i + 1;
    out.set(e.email.toLowerCase(), { rank, points: bordaPoints(rank) });
  });
  return out;
}

export interface OverallPointsInfo {
  gmailRank: number | null;
  gmailPoints: number;
  calendarRank: number | null;
  calendarPoints: number;
  totalPoints: number;
}

/**
 * Combined ranking across gmail and calendar graphs. Each contact gets Borda
 * points (1st=300, 2nd=298, ..., 150th=2, 0 beyond). Calendar points are
 * weighted by 0.5. Contacts are merged by lowercased email.
 */
export function buildOverallGraph(
  gmail: GraphData,
  calendar: CalendarGraphData | null,
  topN?: number,
): { data: GraphData; pointsByEmail: Map<string, OverallPointsInfo> } {
  const gmailContacts = gmail.nodes
    .filter(n => !n.isCenter)
    .map(n => ({ email: n.email, score: n.compositeScore }));
  const calendarContacts = (calendar?.nodes ?? [])
    .filter(n => !n.isCenter)
    .map(n => ({ email: n.email, score: n.calendarScore }));

  const gmailPoints = assignPoints(gmailContacts);
  const calendarPoints = assignPoints(calendarContacts);

  const gmailByEmail = new Map(gmail.nodes.map(n => [n.email.toLowerCase(), n]));
  const calendarByEmail = new Map(
    (calendar?.nodes ?? []).map(n => [n.email.toLowerCase(), n]),
  );

  const allEmails = new Set<string>();
  gmailByEmail.forEach((_, e) => allEmails.add(e));
  calendarByEmail.forEach((_, e) => allEmails.add(e));

  const pointsByEmail = new Map<string, OverallPointsInfo>();
  const nodes: GraphNode[] = [];

  for (const emailLower of allEmails) {
    const g = gmailByEmail.get(emailLower);
    const c = calendarByEmail.get(emailLower);
    const gp = gmailPoints.get(emailLower);
    const cp = calendarPoints.get(emailLower);

    const gmailPts = gp?.points ?? 0;
    const calendarPts = (cp?.points ?? 0) * CALENDAR_WEIGHT;
    const totalPoints = gmailPts + calendarPts;

    const info: OverallPointsInfo = {
      gmailRank: gp?.rank ?? null,
      gmailPoints: gmailPts,
      calendarRank: cp?.rank ?? null,
      calendarPoints: calendarPts,
      totalPoints,
    };
    pointsByEmail.set(emailLower, info);

    // Prefer gmail node fields, fall back to calendar
    const isCenter = g?.isCenter || c?.isCenter || false;
    const name = g?.name ?? c?.name ?? emailLower;
    const email = g?.email ?? c?.email ?? emailLower;
    const id = g?.id ?? c?.id ?? emailLower;

    if (isCenter) {
      nodes.push({
        id,
        name,
        email,
        isCenter: true,
        received: 0,
        sent: 0,
        compositeScore: Number.MAX_SAFE_INTEGER,
      });
      continue;
    }

    nodes.push({
      id,
      name,
      email,
      isCenter: false,
      received: g?.received ?? 0,
      sent: g?.sent ?? 0,
      compositeScore: totalPoints,
      rankings: g?.rankings,
      notClear: g?.notClear,
    });
  }

  // Keep top-N by combined points (always keep center).
  const nonCenter = nodes
    .filter(n => !n.isCenter)
    .sort((a, b) => b.compositeScore - a.compositeScore);
  const cap = topN ?? TOP_N;
  const topNodes = nonCenter.filter(n => n.compositeScore > 0).slice(0, cap);
  const centerNodes = nodes.filter(n => n.isCenter);
  const usefulNodes = [...centerNodes, ...topNodes];

  // Reuse gmail links; calendar contributes ranking + tooltip data + ropes (via eventGroups)
  // on selection rather than additional GraphLink entries.
  const visibleEmails = new Set(usefulNodes.map(n => n.email.toLowerCase()));
  visibleEmails.add('me');
  const links: GraphLink[] = gmail.links.filter(
    l =>
      visibleEmails.has((l.source as string).toLowerCase()) &&
      visibleEmails.has((l.target as string).toLowerCase()),
  );

  const data: GraphData = {
    nodes: usefulNodes,
    links,
    stats: {
      totalContacts: usefulNodes.length - 1,
      displayedContacts: usefulNodes.length - 1,
      totalReceived: gmail.stats.totalReceived,
      totalSent: gmail.stats.totalSent,
    },
  };

  return { data, pointsByEmail };
}
