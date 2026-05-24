import type { EventGroups } from '@gmail-graph/shared';

export interface EventRow {
  uid: string;
  summary: string;
  dtstart: number | null; // unix seconds
  attendees_json: string;
}

interface AttendeeJson {
  email?: string;
  name?: string;
}

interface GroupAccum {
  label: string;
  dtstart: number | null;
  members: Set<string>;
}

/** Format a unix-seconds timestamp as YYYY-MM-DD (UTC); '' if null/invalid. */
function formatDate(ts: number | null): string {
  if (ts == null) return '';
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * Group calendar attendees into "event groups" keyed by event series (uid).
 * Recurring occurrences share a uid and collapse into one group. The webapp
 * user's own email is excluded. Output is keyed by a human label (event title);
 * collisions across distinct uids are disambiguated by appending the start date,
 * then a numeric suffix as a final fallback.
 */
export function buildEventGroups(rows: EventRow[], userEmail: string): EventGroups {
  const userLc = userEmail.trim().toLowerCase();
  const byUid = new Map<string, GroupAccum>();

  for (const r of rows) {
    let attendees: AttendeeJson[];
    try {
      const parsed = JSON.parse(r.attendees_json || '[]');
      attendees = Array.isArray(parsed) ? parsed : [];
    } catch {
      attendees = [];
    }

    let entry = byUid.get(r.uid);
    if (!entry) {
      entry = { label: '', dtstart: r.dtstart ?? null, members: new Set<string>() };
      byUid.set(r.uid, entry);
    }
    if (!entry.label && r.summary && r.summary.trim()) {
      entry.label = r.summary.trim();
    }
    if (r.dtstart != null && (entry.dtstart == null || r.dtstart < entry.dtstart)) {
      entry.dtstart = r.dtstart;
    }
    for (const a of attendees) {
      const email = (a.email || '').trim().toLowerCase();
      if (!email || email === userLc) continue;
      entry.members.add(email);
    }
  }

  const groups: Record<string, string[]> = {};
  const suffixCounters = new Map<string, number>();

  for (const entry of byUid.values()) {
    if (entry.members.size < 2) continue;
    const base = entry.label || '(untitled event)';
    let label = base;
    if (groups[label] !== undefined) {
      const date = formatDate(entry.dtstart);
      label = date ? `${base} — ${date}` : base;
      if (groups[label] !== undefined) {
        const n = (suffixCounters.get(base) ?? 1) + 1;
        suffixCounters.set(base, n);
        label = `${base} (${n})`;
      }
    }
    groups[label] = [...entry.members];
  }

  return { total_groups: Object.keys(groups).length, groups };
}
