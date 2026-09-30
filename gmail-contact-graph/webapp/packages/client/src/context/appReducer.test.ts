import assert from 'node:assert/strict';
import { reducer, initialState, editsLocked } from './AppContext.js';
import type { GraphNode, ImportStatus } from '@gmail-graph/shared';

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

// --- Import ---------------------------------------------------------------

const ready = (importedAt: number | null): ImportStatus =>
  ({ state: 'ready', userEmail: 'me@x.com', importedAt, source: null });
const importing = (hasData: boolean): ImportStatus =>
  ({ state: 'importing', phase: 'mails', progress: 0.5, detail: '', startedAt: 1, hasData });
const failed = (hasData: boolean): ImportStatus =>
  ({ state: 'failed', error: 'boom', log: [], failedAt: 2, hasData });

function statuses(...list: ImportStatus[]) {
  return list.reduce((s, status) => reducer(s, { type: 'SET_IMPORT_STATUS', payload: status }), initialState);
}

// 9. Nothing to load until the server says there is data.
{
  assert.equal(initialState.importStatus, null);
  assert.equal(initialState.dataVersion, null);
  assert.equal(statuses({ state: 'empty' }).dataVersion, null);
  assert.equal(statuses(importing(false)).dataVersion, null);
  assert.equal(statuses(failed(false)).dataVersion, null);
}

// 10. The data version follows the import that produced the data.
{
  assert.equal(statuses(ready(100)).dataVersion, '100');
  assert.equal(statuses(ready(null)).dataVersion, 'cli', 'a database built by the CLI has data too');
  // Polling the same data again changes nothing.
  assert.equal(statuses(ready(100), ready(100)).dataVersion, '100');
  // An import running over existing data keeps showing it...
  assert.equal(statuses(ready(100), importing(true)).dataVersion, '100');
  // ...and its result replaces it.
  assert.equal(statuses(ready(100), importing(true), ready(200)).dataVersion, '200');
  // A failed import leaves the old data in place.
  assert.equal(statuses(ready(100), importing(true), failed(true)).dataVersion, '100');
  // Opened mid-import: the data being served is shown until the import ends.
  assert.equal(statuses(importing(true)).dataVersion, 'current');
  assert.equal(statuses(importing(true), ready(300)).dataVersion, '300');
}

// 11. New data drops a selection that may not exist in it.
{
  const alice = node('alice@x.com');
  let s = statuses(ready(100));
  s = reducer(s, { type: 'SELECT_NODE', payload: alice });
  s = reducer(s, { type: 'ISOLATE_GROUP', payload: 'msg:Trip' });
  const same = reducer(s, { type: 'SET_IMPORT_STATUS', payload: ready(100) });
  assert.equal(same.selectedNode, alice, 'a poll with the same data keeps the selection');
  const fresh = reducer(s, { type: 'SET_IMPORT_STATUS', payload: ready(200) });
  assert.equal(fresh.selectedNode, null);
  assert.equal(fresh.isolatedGroupId, null);
}

// 12. Edits are locked while an import runs.
{
  assert.equal(editsLocked(statuses(ready(1))), false);
  assert.equal(editsLocked(statuses(importing(true))), true);
  assert.equal(editsLocked(statuses(importing(true), failed(true))), false);
  assert.equal(editsLocked(initialState), false);
}

// 13. The import dialog closes when the import it shows succeeds, not when it fails.
{
  let s = reducer(statuses(ready(1)), { type: 'OPEN_IMPORT' });
  assert.equal(s.importDialogOpen, true);
  s = reducer(s, { type: 'SET_IMPORT_STATUS', payload: importing(true) });
  assert.equal(s.importDialogOpen, true);
  assert.equal(reducer(s, { type: 'SET_IMPORT_STATUS', payload: failed(true) }).importDialogOpen, true);
  assert.equal(reducer(s, { type: 'SET_IMPORT_STATUS', payload: ready(2) }).importDialogOpen, false);
  assert.equal(reducer(s, { type: 'CLOSE_IMPORT' }).importDialogOpen, false);
}

// 14. New data from an import finished elsewhere also closes the dialog.
{
  let s = reducer(statuses(ready(1)), { type: 'OPEN_IMPORT' });
  s = reducer(s, { type: 'SET_IMPORT_STATUS', payload: ready(2) });
  assert.equal(s.importDialogOpen, false);
}

// 15. An answer to an older request never overwrites a newer one.
{
  let s = reducer(initialState, { type: 'SET_IMPORT_STATUS', payload: importing(false), seq: 5 });
  s = reducer(s, { type: 'SET_IMPORT_STATUS', payload: { state: 'empty' }, seq: 4 });
  assert.equal(s.importStatus?.state, 'importing', 'the late poll answer is dropped');
  s = reducer(s, { type: 'SET_IMPORT_STATUS', payload: ready(9), seq: 6 });
  assert.equal(s.importStatus?.state, 'ready');
}

// 16. A failed status poll is reported, and cleared by the next answer.
{
  let s = reducer(initialState, { type: 'SET_IMPORT_STATUS_ERROR', payload: 'Failed to fetch' });
  assert.equal(s.importStatusError, 'Failed to fetch');
  s = reducer(s, { type: 'SET_IMPORT_STATUS', payload: ready(1) });
  assert.equal(s.importStatusError, null);
}

// 17. Loading again clears the error of a previous load.
{
  let s = reducer(initialState, { type: 'SET_ERROR', payload: 'API error: 500' });
  s = reducer(s, { type: 'SET_LOADING', payload: true });
  assert.equal(s.error, null);
}

// 18. A first import shows the overlay by itself, also after a page reload.
{
  assert.equal(initialState.importOverlayOpen, false);
  assert.equal(statuses(importing(false)).importOverlayOpen, true);
}

// 19. A reload during a re-import leaves the overlay closed: the banner shows it.
{
  assert.equal(statuses(importing(true)).importOverlayOpen, false);
  assert.equal(statuses(ready(1), importing(true)).importOverlayOpen, false);
}

// 20. During an import, opening the import shows the overlay instead of the dialog.
{
  let s = reducer(statuses(ready(1), importing(true)), { type: 'OPEN_IMPORT' });
  assert.equal(s.importOverlayOpen, true);
  assert.equal(s.importDialogOpen, false);
  // An import started from another tab while the dialog was open closes it too.
  s = reducer(statuses(ready(1)), { type: 'OPEN_IMPORT' });
  s = reducer(s, { type: 'SET_IMPORT_STATUS', payload: importing(true) });
  s = reducer(s, { type: 'OPEN_IMPORT' });
  assert.equal(s.importDialogOpen, false);
  assert.equal(s.importOverlayOpen, true);
}

// 21. With no import running, opening the import shows the dialog, never the overlay.
{
  const s = reducer(statuses(ready(1)), { type: 'OPEN_IMPORT' });
  assert.equal(s.importDialogOpen, true);
  assert.equal(s.importOverlayOpen, false);
  const afterFailure = reducer(statuses(ready(1), importing(true), failed(true)), { type: 'OPEN_IMPORT' });
  assert.equal(afterFailure.importOverlayOpen, false);
}

// 22. The overlay stays open when the import succeeds, so the ending can play.
{
  let s = reducer(statuses(ready(1), importing(true)), { type: 'OPEN_IMPORT' });
  s = reducer(s, { type: 'SET_IMPORT_STATUS', payload: ready(2) });
  assert.equal(s.importOverlayOpen, true);
  assert.equal(s.importDialogOpen, false);
  assert.equal(statuses(importing(false), ready(2)).importOverlayOpen, true);
}

// 23. A failed or cancelled import closes the overlay at once.
{
  assert.equal(statuses(importing(false), failed(false)).importOverlayOpen, false);
  assert.equal(statuses(importing(false), { state: 'empty' }).importOverlayOpen, false);
  const s = reducer(statuses(ready(1), importing(true)), { type: 'OPEN_IMPORT' });
  assert.equal(reducer(s, { type: 'SET_IMPORT_STATUS', payload: failed(true) }).importOverlayOpen, false);
}

// 24. Hide (and the end of the animation) closes it; the next polls keep it closed.
{
  let s = reducer(statuses(ready(1), importing(true)), { type: 'OPEN_IMPORT' });
  s = reducer(s, { type: 'CLOSE_IMPORT' });
  assert.equal(s.importOverlayOpen, false);
  s = reducer(s, { type: 'SET_IMPORT_STATUS', payload: importing(true) });
  assert.equal(s.importOverlayOpen, false);
  s = reducer(s, { type: 'SET_IMPORT_STATUS', payload: ready(2) });
  assert.equal(s.importOverlayOpen, false, 'finished while hidden: no ending');
}

console.log('appReducer: all assertions passed');
