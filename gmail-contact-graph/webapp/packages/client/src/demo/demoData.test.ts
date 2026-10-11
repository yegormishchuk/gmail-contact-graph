import assert from 'node:assert/strict';
import type { CalendarGraphData, CalendarNode } from '@gmail-graph/shared';
import { NO_CALENDAR_STATS, NO_EVENT_GROUPS, withCenterName, withoutCalendar } from './demoData.js';

function calNode(email: string, isCenter = false): CalendarNode {
  return {
    id: isCenter ? 'me' : email, name: email.split('@')[0], email, isCenter, totalEvents: isCenter ? 0 : 3,
    organizedEvents: 0, avgDurationSeconds: null, avgAttendees: null, acceptanceRate: null, calendarScore: 1,
  };
}

const CAL: CalendarGraphData = {
  nodes: [calNode('you@example.com', true), calNode('a@acme.example'), calNode('b@acme.example')],
  userEmail: 'you@example.com',
};

// 1. The visitor's name goes on the centre node only, without touching the input.
{
  const named = withCenterName(CAL, 'Sam Rivera');
  assert.deepEqual(named.nodes.map((n) => n.name), ['Sam Rivera', 'a', 'b']);
  assert.equal(CAL.nodes[0].name, 'you');
  assert.equal(withCenterName(CAL, ''), CAL, 'no name: the server answer as it is');
}

// 2. Without the calendar: the centre node alone, as the server answers for a
//    database without calendar tables.
{
  assert.deepEqual(withoutCalendar(CAL), { nodes: [CAL.nodes[0]], userEmail: 'you@example.com' });
  assert.equal(NO_CALENDAR_STATS.totalMeetings, 0);
  assert.equal(NO_CALENDAR_STATS.topByScore, null);
  assert.deepEqual(NO_EVENT_GROUPS, { total_groups: 0, groups: {} });
}

console.log('demoData: all assertions passed');
