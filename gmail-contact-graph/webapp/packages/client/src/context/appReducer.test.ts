import assert from 'node:assert/strict';
import { reducer, initialState } from './AppContext.js';
import type { GraphNode } from '@gmail-graph/shared';

function node(email: string): GraphNode {
  return {
    id: email,
    name: email,
    email,
    isCenter: false,
    received: 1,
    sent: 1,
    compositeScore: 1,
  };
}

// 1. Nothing is isolated to begin with.
{
  assert.equal(initialState.isolatedGroupId, null);
}

// 2. Isolating a group records it.
{
  const s = reducer(initialState, { type: 'ISOLATE_GROUP', payload: 'msg:Trip' });
  assert.equal(s.isolatedGroupId, 'msg:Trip');
}

// 3. Isolating the same group again clears it — the row is a toggle.
{
  const isolated = reducer(initialState, { type: 'ISOLATE_GROUP', payload: 'msg:Trip' });
  const off = reducer(isolated, { type: 'ISOLATE_GROUP', payload: 'msg:Trip' });
  assert.equal(off.isolatedGroupId, null);
}

// 4. Isolating a different group switches to it rather than clearing.
{
  const isolated = reducer(initialState, { type: 'ISOLATE_GROUP', payload: 'msg:Trip' });
  const other = reducer(isolated, { type: 'ISOLATE_GROUP', payload: 'domain:@nd.edu' });
  assert.equal(other.isolatedGroupId, 'domain:@nd.edu');
}

// 5. Selecting another contact drops the isolation — their groups are different.
{
  const isolated = reducer(initialState, { type: 'ISOLATE_GROUP', payload: 'msg:Trip' });
  const s = reducer(isolated, { type: 'SELECT_NODE', payload: node('bob@x.com') });
  assert.equal(s.isolatedGroupId, null);
}

// 6. Closing the panel (deselecting) drops it too.
{
  const isolated = reducer(initialState, { type: 'ISOLATE_GROUP', payload: 'msg:Trip' });
  const s = reducer(isolated, { type: 'SELECT_NODE', payload: null });
  assert.equal(s.isolatedGroupId, null);
}

// 7. Switching view mode drops it — the isolated group may not exist there.
{
  const isolated = reducer(initialState, { type: 'ISOLATE_GROUP', payload: 'msg:Trip' });
  const s = reducer(isolated, { type: 'SET_FILTER_TYPE', payload: 'calendar' });
  assert.equal(s.isolatedGroupId, null);
}

// 8. Removing the selected contact as spam clears the isolation with it.
{
  const alice = node('alice@x.com');
  const withData = reducer(initialState, {
    type: 'SET_DATA',
    payload: {
      graph: {
        nodes: [alice],
        links: [],
        stats: { totalContacts: 1, displayedContacts: 1, totalReceived: 1, totalSent: 1 },
      },
      domains: { total_domains: 0, domain_groups: {} },
      groups: { total_groups: 0, groups: {} },
      excluded: [],
    },
  });
  const selected = reducer(withData, { type: 'SELECT_NODE', payload: alice });
  const isolated = reducer(selected, { type: 'ISOLATE_GROUP', payload: 'msg:Trip' });
  const removed = reducer(isolated, { type: 'REMOVE_CONTACT', payload: 'alice@x.com' });
  assert.equal(removed.selectedNode, null);
  assert.equal(removed.isolatedGroupId, null);
}

console.log('appReducer: all assertions passed');
