import assert from 'node:assert/strict';
import {
  getSelectedGroups,
  supportsIsolation,
  shouldDimNonMembers,
  shouldDrawRope,
  ROPE_MAX_SIZE,
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

console.log('selectedGroups: all assertions passed');
