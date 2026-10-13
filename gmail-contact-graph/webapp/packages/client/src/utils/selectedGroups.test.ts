import assert from 'node:assert/strict';
import {
  getSelectedGroups,
  supportsIsolation,
  shouldDimNonMembers,
  shouldDrawRope,
  ROPE_MAX_SIZE,
  MAX_DRAWN_GROUPS,
  ranksGroups,
  showsGroupColor,
  type SelectedGroup,
} from './selectedGroups.js';
import { graphConfig } from './graphConfig.js';
import type { DomainGroups, MessageGroups, EventGroups } from '@gmail-graph/shared';

// Helpers ────────────────────────────────────────────────────────────────────

function domains(map: Record<string, string[]>): DomainGroups {
  const domain_groups = Object.fromEntries(
    Object.entries(map).map(([d, emails]) => [
      d,
      emails.map(email => ({ name: email, email, received: 0, sent: 0, total: 0 })),
    ]),
  );
  return { total_domains: Object.keys(domain_groups).length, domain_groups };
}

function groups(map: Record<string, string[]>): MessageGroups & EventGroups {
  return { total_groups: Object.keys(map).length, groups: map };
}

const ids = (gs: SelectedGroup[]) => gs.map(g => g.id);

// 1. No memberships anywhere -> empty list.
{
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: null,
    messageGroups: null,
    eventGroups: null,
    filterType: 'gmail',
  });
  assert.deepEqual(r, []);
}

// 2. Domain row appears when the org has >= 2 contacts, and carries the domain colour.
{
  const r = getSelectedGroups({
    email: 'alice@nd.edu',
    domains: domains({ 'nd.edu': ['alice@nd.edu', 'bob@nd.edu'] }),
    messageGroups: null,
    eventGroups: null,
    filterType: 'gmail',
  });
  assert.deepEqual(ids(r), ['domain:@nd.edu']);
  assert.equal(r[0].kind, 'domain');
  assert.equal(r[0].label, '@nd.edu');
  assert.equal(r[0].count, 2);
  assert.equal(r[0].color, graphConfig.domainColor);
  assert.deepEqual(r[0].memberEmails.sort(), ['alice@nd.edu', 'bob@nd.edu']);
}

// 3. A solo domain (only the contact themself) is not a group.
{
  const r = getSelectedGroups({
    email: 'alice@nd.edu',
    domains: domains({ 'nd.edu': ['alice@nd.edu'] }),
    messageGroups: null,
    eventGroups: null,
    filterType: 'gmail',
  });
  assert.deepEqual(r, []);
}

// 4. Message groups: only those containing the contact, only >= 3 members,
//    sorted by member count descending.
{
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: null,
    messageGroups: groups({
      Small: ['alice@x.com', 'bob@x.com'],
      Big: ['alice@x.com', 'bob@x.com', 'carol@x.com', 'dave@x.com'],
      Medium: ['alice@x.com', 'bob@x.com', 'carol@x.com'],
      Unrelated: ['bob@x.com', 'carol@x.com', 'dave@x.com'],
    }),
    eventGroups: null,
    filterType: 'gmail',
  });
  assert.deepEqual(ids(r), ['msg:Big', 'msg:Medium']);
  assert.deepEqual(r.map(g => g.count), [4, 3]);
  assert.deepEqual(r.map(g => g.color), [graphConfig.groupColors[0], graphConfig.groupColors[1]]);
}

// 5. Membership matching is case-insensitive and emails come back lowercased.
{
  const r = getSelectedGroups({
    email: 'Alice@X.com',
    domains: null,
    messageGroups: groups({ Trip: ['ALICE@x.com', 'Bob@X.com', 'carol@x.com'] }),
    eventGroups: null,
    filterType: 'gmail',
  });
  assert.deepEqual(ids(r), ['msg:Trip']);
  assert.deepEqual(r[0].memberEmails.sort(), ['alice@x.com', 'bob@x.com', 'carol@x.com']);
}

// 6. Calendar mode: event groups only — no domain row, no message groups.
{
  const r = getSelectedGroups({
    email: 'alice@nd.edu',
    domains: domains({ 'nd.edu': ['alice@nd.edu', 'bob@nd.edu'] }),
    messageGroups: groups({ Thread: ['alice@nd.edu', 'bob@nd.edu', 'carol@nd.edu'] }),
    eventGroups: groups({ Standup: ['alice@nd.edu', 'bob@nd.edu', 'carol@nd.edu'] }),
    filterType: 'calendar',
  });
  assert.deepEqual(ids(r), ['evt:Standup']);
  assert.equal(r[0].kind, 'event');
  assert.equal(r[0].color, graphConfig.groupColors[0]);
}

// 7. Gmail mode ignores event groups entirely.
{
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: null,
    messageGroups: null,
    eventGroups: groups({ Standup: ['alice@x.com', 'bob@x.com', 'carol@x.com'] }),
    filterType: 'gmail',
  });
  assert.deepEqual(r, []);
}

// 8. Overall mode: domain, then message groups, then event groups — and the
//    event palette is offset past the message groups so colours never collide.
{
  const r = getSelectedGroups({
    email: 'alice@nd.edu',
    domains: domains({ 'nd.edu': ['alice@nd.edu', 'bob@nd.edu'] }),
    messageGroups: groups({
      ThreadA: ['alice@nd.edu', 'bob@nd.edu', 'carol@nd.edu'],
      ThreadB: ['alice@nd.edu', 'bob@nd.edu', 'dave@nd.edu'],
    }),
    eventGroups: groups({ Standup: ['alice@nd.edu', 'bob@nd.edu', 'carol@nd.edu'] }),
    filterType: 'overall',
  });
  assert.deepEqual(ids(r), ['domain:@nd.edu', 'msg:ThreadA', 'msg:ThreadB', 'evt:Standup']);
  assert.equal(r[1].color, graphConfig.groupColors[0]);
  assert.equal(r[2].color, graphConfig.groupColors[1]);
  // two message groups precede it, so the event group takes palette slot 2
  assert.equal(r[3].color, graphConfig.groupColors[2]);
}

// 9. Event groups are capped at MAX_EVENT_GROUPS (8) so the panel never lists a
//    row the graph has no rope for.
{
  const many: Record<string, string[]> = {};
  for (let i = 0; i < 12; i++) {
    // descending sizes so ordering is unambiguous
    const members = ['alice@x.com'];
    for (let j = 0; j < 20 - i; j++) members.push(`m${i}_${j}@x.com`);
    many[`Event${i}`] = members;
  }
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: null,
    messageGroups: null,
    eventGroups: groups(many),
    filterType: 'calendar',
  });
  assert.equal(r.length, 8);
  assert.deepEqual(ids(r)[0], 'evt:Event0');
  assert.deepEqual(ids(r)[7], 'evt:Event7');
}

// 10. Group-display modes still list memberships in the panel: the message and
//     org cluster modes read like gmail, the event cluster mode like calendar.
{
  const args = {
    email: 'alice@nd.edu',
    domains: domains({ 'nd.edu': ['alice@nd.edu', 'bob@nd.edu'] }),
    messageGroups: groups({ Thread: ['alice@nd.edu', 'bob@nd.edu', 'carol@nd.edu'] }),
    eventGroups: groups({ Standup: ['alice@nd.edu', 'bob@nd.edu', 'carol@nd.edu'] }),
  };
  for (const filterType of ['messageGroups', 'organizations'] as const) {
    assert.deepEqual(
      ids(getSelectedGroups({ ...args, filterType })),
      ['domain:@nd.edu', 'msg:Thread'],
      `${filterType} should list what gmail mode lists`,
    );
  }
  assert.deepEqual(
    ids(getSelectedGroups({ ...args, filterType: 'eventGroups' })),
    ['evt:Standup'],
    'eventGroups should list what calendar mode lists',
  );
}

// 10b. ...but those modes draw clusters instead of ropes, so their rows are not
//      isolatable — a click there would toggle nothing on screen.
{
  assert.equal(supportsIsolation('overall'), true);
  assert.equal(supportsIsolation('gmail'), true);
  assert.equal(supportsIsolation('calendar'), true);
  assert.equal(supportsIsolation('messageGroups'), false);
  assert.equal(supportsIsolation('organizations'), false);
  assert.equal(supportsIsolation('eventGroups'), false);
}

// 11. More than 8 message groups wrap around the palette rather than running off
//     the end of it.
{
  const many: Record<string, string[]> = {};
  for (let i = 0; i < 10; i++) {
    const members = ['alice@x.com'];
    for (let j = 0; j < 20 - i; j++) members.push(`m${i}_${j}@x.com`);
    many[`Thread${i}`] = members;
  }
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: null,
    messageGroups: groups(many),
    eventGroups: null,
    filterType: 'gmail',
  });
  assert.equal(r.length, 10);
  assert.equal(r[8].color, graphConfig.groupColors[0]);
  assert.equal(r[9].color, graphConfig.groupColors[1]);
}

// 12. Ids are unique across kinds even when a thread and an event share a label.
{
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: null,
    messageGroups: groups({ Sync: ['alice@x.com', 'bob@x.com', 'carol@x.com'] }),
    eventGroups: groups({ Sync: ['alice@x.com', 'bob@x.com', 'carol@x.com'] }),
    filterType: 'overall',
  });
  assert.deepEqual(ids(r), ['msg:Sync', 'evt:Sync']);
  assert.equal(new Set(ids(r)).size, 2);
}

// 13. Without isolation, a contact whose group-mates are all off-graph (only the
//     contact themself is visible) leaves the graph undimmed — nothing to focus on.
{
  assert.equal(shouldDimNonMembers(1, false), false);
  assert.equal(shouldDimNonMembers(0, false), false);
  assert.equal(shouldDimNonMembers(2, false), true);
}

// 14. With isolation, everyone outside the group dims even when no other member
//     made it onto the graph — the user asked to see only that group, and
//     leaving the graph bright made the click look like it did nothing.
{
  assert.equal(shouldDimNonMembers(1, true), true);
  assert.equal(shouldDimNonMembers(0, true), true);
  assert.equal(shouldDimNonMembers(5, true), true);
}

// 15. The rope-vs-border choice counts members on the graph, not the group's
//     full size — a 30-person thread with 3 contacts on screen still gets a rope.
{
  assert.equal(shouldDrawRope(ROPE_MAX_SIZE), true);
  assert.equal(shouldDrawRope(ROPE_MAX_SIZE + 1), false);
  assert.equal(shouldDrawRope(3), true);
}

// 16. Without visibleEmails every group is drawn and keeps today's order.
{
  const r = getSelectedGroups({
    email: 'alice@nd.edu',
    domains: domains({ 'nd.edu': ['alice@nd.edu', 'bob@nd.edu'] }),
    messageGroups: groups({ Thread: ['alice@nd.edu', 'bob@nd.edu', 'carol@nd.edu'] }),
    eventGroups: null,
    filterType: 'gmail',
  });
  assert.deepEqual(ids(r), ['domain:@nd.edu', 'msg:Thread']);
  assert.ok(r.every(g => g.drawn));
}

// 17. Only overall and gmail rank — the other modes keep their own layout.
{
  assert.equal(ranksGroups('overall'), true);
  assert.equal(ranksGroups('gmail'), true);
  assert.equal(ranksGroups('calendar'), false);
  assert.equal(ranksGroups('messageGroups'), false);
  assert.equal(ranksGroups('organizations'), false);
  assert.equal(ranksGroups('eventGroups'), false);
}

// A contact in six message groups, Thread0 biggest. visible() puts the first
// `n` members of each group on the graph.
const sixThreads: Record<string, string[]> = {};
for (let i = 0; i < 6; i++) {
  const members = ['alice@x.com'];
  for (let j = 0; j < 10 - i; j++) members.push(`t${i}_${j}@x.com`);
  sixThreads[`Thread${i}`] = members;
}
const visible = (perGroup: Record<string, number>) =>
  new Set([
    'alice@x.com',
    ...Object.entries(perGroup).flatMap(([label, n]) => sixThreads[label].slice(1, 1 + n)),
  ]);

// 18. With visibleEmails, groups rank by members on the graph and only the
//     top MAX_DRAWN_GROUPS are drawn — the smallest group can outrank the biggest.
{
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: null,
    messageGroups: groups(sixThreads),
    eventGroups: null,
    filterType: 'gmail',
    visibleEmails: visible({ Thread5: 4, Thread4: 3, Thread3: 2, Thread2: 1 }),
  });
  assert.equal(MAX_DRAWN_GROUPS, 4);
  assert.deepEqual(ids(r), [
    'msg:Thread5', 'msg:Thread4', 'msg:Thread3', 'msg:Thread2', 'msg:Thread0', 'msg:Thread1',
  ]);
  assert.deepEqual(r.map(g => g.drawn), [true, true, true, true, false, false]);
}

// 19. Ties in visible count go to the bigger group, then to the original order —
//     the panel and the graph must agree on every run.
{
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: null,
    messageGroups: groups(sixThreads),
    eventGroups: null,
    filterType: 'gmail',
    visibleEmails: new Set(['alice@x.com']),
  });
  assert.deepEqual(ids(r), [
    'msg:Thread0', 'msg:Thread1', 'msg:Thread2', 'msg:Thread3', 'msg:Thread4', 'msg:Thread5',
  ]);
}

// 20. Colours follow rank, so the drawn groups always get distinct palette slots.
{
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: null,
    messageGroups: groups(sixThreads),
    eventGroups: null,
    filterType: 'gmail',
    visibleEmails: visible({ Thread5: 4, Thread4: 3, Thread3: 2, Thread2: 1 }),
  });
  assert.deepEqual(r.map(g => g.color), graphConfig.groupColors.slice(0, 6));
}

// 21. The org competes like any group: it can lose its slot, and keeps the
//     domain colour either way. Palette slots skip it.
{
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: domains({ 'x.com': ['alice@x.com', 'zed@x.com'] }),
    messageGroups: groups(sixThreads),
    eventGroups: null,
    filterType: 'gmail',
    visibleEmails: visible({ Thread5: 4, Thread4: 3, Thread3: 2, Thread2: 1 }),
  });
  const org = r.find(g => g.kind === 'domain')!;
  assert.equal(org.drawn, false);
  assert.equal(org.color, graphConfig.domainColor);
  assert.equal(r.filter(g => g.drawn).length, MAX_DRAWN_GROUPS);
  assert.deepEqual(
    r.filter(g => g.kind !== 'domain').map(g => g.color),
    graphConfig.groupColors.slice(0, 6),
  );
}

// 22. Overall mode ranks message and event groups in one list.
{
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: null,
    messageGroups: groups({ Thread: ['alice@x.com', 'bob@x.com', 'carol@x.com'] }),
    eventGroups: groups({ Standup: ['alice@x.com', 'dan@x.com', 'eve@x.com'] }),
    filterType: 'overall',
    visibleEmails: new Set(['alice@x.com', 'dan@x.com', 'eve@x.com']),
  });
  assert.deepEqual(ids(r), ['evt:Standup', 'msg:Thread']);
  assert.deepEqual(r.map(g => g.color), graphConfig.groupColors.slice(0, 2));
}

// 23. Four or fewer groups: all drawn.
{
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: domains({ 'x.com': ['alice@x.com', 'zed@x.com'] }),
    messageGroups: groups({
      A: ['alice@x.com', 'b@x.com', 'c@x.com'],
      B: ['alice@x.com', 'd@x.com', 'e@x.com'],
      C: ['alice@x.com', 'f@x.com', 'g@x.com'],
    }),
    eventGroups: null,
    filterType: 'gmail',
    visibleEmails: new Set(['alice@x.com']),
  });
  assert.equal(r.length, 4);
  assert.ok(r.every(g => g.drawn));
}

// 24. Calendar mode ignores visibleEmails: order, colours and drawn stay as today.
{
  const r = getSelectedGroups({
    email: 'alice@x.com',
    domains: null,
    messageGroups: null,
    eventGroups: groups(sixThreads),
    filterType: 'calendar',
    visibleEmails: visible({ Thread5: 4 }),
  });
  assert.equal(ids(r)[0], 'evt:Thread0');
  assert.equal(r[0].color, graphConfig.groupColors[0]);
  assert.ok(r.every(g => g.drawn));
}

// 25. A panel row shows its colour while the graph shows the group: drawn,
//     isolated, or an undrawn org (its members keep org borders). Other hidden
//     groups are greyed until isolated.
{
  const g = (kind: SelectedGroup['kind'], drawn: boolean) =>
    ({ id: 'x', kind, label: 'x', memberEmails: [], count: 3, color: '#000', drawn }) as SelectedGroup;
  assert.equal(showsGroupColor(g('message', true), false), true);
  assert.equal(showsGroupColor(g('message', false), false), false);
  assert.equal(showsGroupColor(g('event', false), true), true);
  assert.equal(showsGroupColor(g('domain', false), false), true);
}

// 26. No group colour can be mistaken for the org's: an undrawn org marks its
//     members with domainColor borders next to the drawn groups' ropes.
{
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const org = rgb(graphConfig.domainColor);
  for (const color of graphConfig.groupColors) {
    const distance = Math.hypot(...rgb(color).map((v, i) => v - org[i]));
    assert.ok(distance > 60, `${color} is too close to the org colour ${graphConfig.domainColor}`);
  }
}

console.log('selectedGroups: all assertions passed');
