import assert from 'node:assert/strict';
import { buildEventGroups, type EventRow } from './eventGroups.js';

// dtstart values are unix SECONDS (matches events.dtstart in the DB).
const DAY = 86400;
const JAN_15_2024 = 1705276800; // 2024-01-15T00:00:00Z

function row(partial: Partial<EventRow>): EventRow {
  return { uid: 'u', summary: '', dtstart: null, attendees_json: '[]', ...partial };
}

// 1. Empty input -> empty result.
{
  const r = buildEventGroups([], 'me@x.com');
  assert.equal(r.total_groups, 0);
  assert.deepEqual(r.groups, {});
}

// 2. Recurring occurrences (same uid) collapse into ONE group; self excluded.
{
  const attendees = JSON.stringify([
    { email: 'me@x.com' }, { email: 'Alice@x.com' }, { email: 'bob@x.com' },
  ]);
  const rows = [
    row({ uid: 'series1', summary: 'Standup', dtstart: JAN_15_2024, attendees_json: attendees }),
    row({ uid: 'series1', summary: 'Standup', dtstart: JAN_15_2024 + 7 * DAY, attendees_json: attendees }),
    row({ uid: 'series1', summary: 'Standup', dtstart: JAN_15_2024 + 14 * DAY, attendees_json: attendees }),
  ];
  const r = buildEventGroups(rows, 'me@x.com');
  assert.equal(r.total_groups, 1);
  assert.deepEqual(r.groups['Standup'].sort(), ['alice@x.com', 'bob@x.com']);
}

// 3. Groups with < 2 non-self attendees are dropped.
{
  const rows = [
    row({ uid: 'solo', summary: 'Just us', attendees_json: JSON.stringify([{ email: 'me@x.com' }, { email: 'only@x.com' }]) }),
  ];
  // only 1 non-self member -> dropped
  const r = buildEventGroups(rows, 'me@x.com');
  assert.equal(r.total_groups, 0);
}

// 4. Label collision across distinct uids -> date-suffixed label.
{
  const att = JSON.stringify([{ email: 'a@x.com' }, { email: 'b@x.com' }]);
  const rows = [
    row({ uid: 's1', summary: '1:1', dtstart: JAN_15_2024, attendees_json: att }),
    row({ uid: 's2', summary: '1:1', dtstart: JAN_15_2024 + 30 * DAY, attendees_json: att }),
  ];
  const r = buildEventGroups(rows, 'me@x.com');
  assert.equal(r.total_groups, 2);
  assert.ok(r.groups['1:1'], 'first keeps base label');
  assert.ok(r.groups['1:1 — 2024-02-14'], 'second is date-suffixed');
  assert.deepEqual(r.groups['1:1'].sort(), ['a@x.com', 'b@x.com']);
  assert.deepEqual(r.groups['1:1 — 2024-02-14'].sort(), ['a@x.com', 'b@x.com']);
}

// 5. Untitled events get a placeholder label.
{
  const rows = [
    row({ uid: 'noTitle', summary: '', attendees_json: JSON.stringify([{ email: 'a@x.com' }, { email: 'b@x.com' }]) }),
  ];
  const r = buildEventGroups(rows, 'me@x.com');
  assert.ok(r.groups['(untitled event)']);
}

// 6. Malformed attendees_json is tolerated (treated as empty).
{
  const rows = [row({ uid: 'bad', summary: 'X', attendees_json: 'not json' })];
  const r = buildEventGroups(rows, 'me@x.com');
  assert.equal(r.total_groups, 0);
}

console.log('eventGroups.test.ts: all assertions passed');
