import type { DomainGroups, MessageGroups, EventGroups } from '@gmail-graph/shared';
import { graphConfig } from './graphConfig';

/** A group must have at least this many members before it is drawn at all. */
export const MIN_GROUP_SIZE = 3;
/** An org needs at least this many contacts to be worth a rope. */
export const MIN_DOMAIN_SIZE = 2;
/** Event groups are capped so a contact with a busy calendar stays readable. */
export const MAX_EVENT_GROUPS = 8;
/** Above this many on-graph members a rope turns into a hairball, so borders mark the group instead. */
export const ROPE_MAX_SIZE = 8;
/** A busy contact draws only this many groups at once; the rest are isolated one at a time. */
export const MAX_DRAWN_GROUPS = 4;

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
  /** Whether the graph draws it without isolation (see MAX_DRAWN_GROUPS). */
  drawn: boolean;
}

interface Params {
  email: string;
  domains: DomainGroups | null;
  messageGroups: MessageGroups | null;
  eventGroups: EventGroups | null;
  filterType: FilterType;
  /** Lower-cased emails of every node on the graph. Enables ranking and the cap. */
  visibleEmails?: Set<string>;
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
 * Whether a group is drawn as a rope rather than coloured borders.
 *
 * `visibleMemberCount` counts only members actually on the graph, the selected
 * contact included — a big group with few contacts on screen is still readable
 * as a rope, and members that aren't drawn can't tangle it.
 */
export function shouldDrawRope(visibleMemberCount: number): boolean {
  return visibleMemberCount <= ROPE_MAX_SIZE;
}

/**
 * Whether a mode draws per-contact connections that isolating can narrow. The
 * cluster modes draw groups as their own circles instead of ropes off a
 * selected contact, so their rows are listed but not clickable.
 */
export function supportsIsolation(filterType: FilterType): boolean {
  return filterType === 'overall' || filterType === 'gmail' || filterType === 'calendar';
}

/**
 * Whether a mode ranks a selected contact's groups and caps how many are drawn.
 * Calendar colours borders by event group with its own cap, and the cluster
 * modes draw no per-contact connections at all.
 */
export function ranksGroups(filterType: FilterType): boolean {
  return filterType === 'overall' || filterType === 'gmail';
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
 * The ordered list of groups for a selected contact, read by both the graph and
 * the detail panel. By default: org first, then message groups, then event
 * groups. In overall and gmail mode with `visibleEmails`, the list is ranked by
 * members on the graph and only the top MAX_DRAWN_GROUPS are `drawn`.
 */
export function getSelectedGroups({
  email,
  domains,
  messageGroups,
  eventGroups,
  filterType,
  visibleEmails,
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
        drawn: true,
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
      drawn: true,
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
          drawn: true,
        });
      });
  }

  if (!visibleEmails || !ranksGroups(filterType)) return result;

  // Rank by members actually on the graph, so the drawn slots go to the groups
  // that draw something. Ties: bigger group, then the original order.
  const ranked = result
    .map((g, index) => ({ g, index, visible: g.memberEmails.filter(e => visibleEmails.has(e)).length }))
    .sort((a, b) => b.visible - a.visible || b.g.count - a.g.count || a.index - b.index);

  // Colours follow rank so the drawn groups never share a palette slot.
  let slot = 0;
  return ranked.map(({ g }, rank) => ({
    ...g,
    drawn: rank < MAX_DRAWN_GROUPS,
    color: g.kind === 'domain' ? g.color : palette(slot++),
  }));
}
