import type { DomainGroups, MessageGroups, EventGroups } from '@gmail-graph/shared';
import { graphConfig } from './graphConfig';

/** A group must have at least this many members before it is drawn at all. */
export const MIN_GROUP_SIZE = 3;
/** An org needs at least this many contacts to be worth a rope. */
export const MIN_DOMAIN_SIZE = 2;
/** Event groups are capped so a contact with a busy calendar stays readable. */
export const MAX_EVENT_GROUPS = 8;

export type FilterType =
  | 'overall'
  | 'gmail'
  | 'calendar'
  | 'messageGroups'
  | 'organizations'
  | 'eventGroups';

/**
 * One group the selected contact belongs to, as both the graph and the detail
 * panel see it. `color` is resolved here — not at render time — so isolating a
 * single group can never shift anybody's palette slot.
 */
export interface SelectedGroup {
  id: string;
  kind: 'domain' | 'message' | 'event';
  label: string;
  memberEmails: string[];
  count: number;
  color: string;
}

interface Params {
  email: string;
  domains: DomainGroups | null;
  messageGroups: MessageGroups | null;
  eventGroups: EventGroups | null;
  filterType: FilterType;
}

const palette = (i: number) => graphConfig.groupColors[i % graphConfig.groupColors.length];

/**
 * Whether contacts outside the highlighted groups should fade.
 *
 * `visibleMemberCount` counts group members actually on the graph, the selected
 * contact included. Normally a lone contact with no visible group-mates leaves
 * the graph bright — there's nothing to focus on. Isolating is an explicit ask
 * to see only one group, though, so it always dims, even when every other
 * member is off-graph.
 */
export function shouldDimNonMembers(visibleMemberCount: number, isolated: boolean): boolean {
  return isolated || visibleMemberCount > 1;
}

/**
 * Whether a mode draws per-contact connections that isolating can narrow. The
 * cluster modes draw groups as their own circles instead of ropes off a
 * selected contact, so their rows are listed but not clickable.
 */
export function supportsIsolation(filterType: FilterType): boolean {
  return filterType === 'overall' || filterType === 'gmail' || filterType === 'calendar';
}

/** Groups containing `email` with enough members, largest first. */
function membershipsOf(
  source: Record<string, string[]> | undefined,
  email: string,
): { label: string; memberEmails: string[] }[] {
  if (!source) return [];
  return Object.entries(source)
    .map(([label, emails]) => ({ label, memberEmails: emails.map(e => e.toLowerCase()) }))
    .filter(g => g.memberEmails.length >= MIN_GROUP_SIZE && g.memberEmails.includes(email))
    .sort((a, b) => b.memberEmails.length - a.memberEmails.length);
}

/**
 * The ordered list of groups drawn for a selected contact: org first, then
 * message groups, then event groups — matching both the rope draw order and the
 * order of rows in the detail panel.
 */
export function getSelectedGroups({
  email,
  domains,
  messageGroups,
  eventGroups,
  filterType,
}: Params): SelectedGroup[] {
  const selected = email.toLowerCase();
  // The cluster modes list what their single-contact counterpart lists.
  const isCalendar = filterType === 'calendar' || filterType === 'eventGroups';
  const isOverall = filterType === 'overall';
  const result: SelectedGroup[] = [];

  // ── Org ─────────────────────────────────────────────────────────────────────
  // Calendar mode colours co-attendees by event group only, with no org rope.
  if (!isCalendar) {
    const domain = selected.split('@')[1];
    const users = domain ? domains?.domain_groups?.[domain] : undefined;
    if (users && users.length >= MIN_DOMAIN_SIZE) {
      result.push({
        id: `domain:@${domain}`,
        kind: 'domain',
        label: `@${domain}`,
        memberEmails: users.map(u => u.email.toLowerCase()),
        count: users.length,
        color: graphConfig.domainColor,
      });
    }
  }

  // ── Message groups ──────────────────────────────────────────────────────────
  const msgGroups = isCalendar ? [] : membershipsOf(messageGroups?.groups, selected);
  msgGroups.forEach((g, i) => {
    result.push({
      id: `msg:${g.label}`,
      kind: 'message',
      label: g.label,
      memberEmails: g.memberEmails,
      count: g.memberEmails.length,
      color: palette(i),
    });
  });

  // ── Event groups ────────────────────────────────────────────────────────────
  if (isCalendar || isOverall) {
    membershipsOf(eventGroups?.groups, selected)
      .slice(0, MAX_EVENT_GROUPS)
      .forEach((g, i) => {
        result.push({
          id: `evt:${g.label}`,
          kind: 'event',
          label: g.label,
          memberEmails: g.memberEmails,
          count: g.memberEmails.length,
          // Offset past the message groups so event colours never collide.
          color: palette(i + msgGroups.length),
        });
      });
  }

  return result;
}
