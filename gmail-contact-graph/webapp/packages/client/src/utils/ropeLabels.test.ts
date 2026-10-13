import assert from 'node:assert/strict';
import { placeRopeLabels, LABEL_HEIGHT, type RopeEdge } from './ropeLabels.js';

const edge = (x1: number, y1: number, x2: number, y2: number): RopeEdge => ({ x1, y1, x2, y2 });

// Two ropes through the same first pair of nodes, each with a second edge far away.
const shared = edge(0, 0, 100, 0);
const ropeA = [shared, edge(0, 0, 0, 200)];
const ropeB = [shared, edge(100, 0, 300, 300)];

// 1. Free first edge is used.
assert.deepEqual(placeRopeLabels([{ edges: ropeA, width: 60, current: null }]), [0]);

// 2. Two ropes sharing edge 0: the lower-ranked one moves to its next edge.
assert.deepEqual(
  placeRopeLabels([
    { edges: ropeA, width: 60, current: null },
    { edges: ropeB, width: 60, current: null },
  ]),
  [0, 1],
);

// 3. Every edge collides -> the label is hidden.
assert.deepEqual(
  placeRopeLabels([
    { edges: [shared], width: 60, current: null },
    { edges: [shared], width: 60, current: null },
  ]),
  [0, null],
);

// 4. Hysteresis: a free remembered edge is kept even though edge 0 is free too.
assert.deepEqual(placeRopeLabels([{ edges: ropeA, width: 60, current: 1 }]), [1]);

// 5. A remembered edge that collides is dropped for the first free one.
assert.deepEqual(
  placeRopeLabels([
    { edges: ropeA, width: 60, current: null },
    { edges: [edge(300, 300, 400, 400), shared], width: 60, current: 1 },
  ]),
  [0, 0],
);

// 6. A remembered edge past the end (the rope shrank) falls back to scanning.
assert.deepEqual(placeRopeLabels([{ edges: ropeA, width: 60, current: 7 }]), [0]);

// 7. Boxes only collide when they overlap on both axes: same x but one label
//    height apart is fine, a hair closer is not.
{
  const top = edge(0, 0, 100, 0);
  const below = edge(0, LABEL_HEIGHT, 100, LABEL_HEIGHT);
  const tooClose = edge(0, LABEL_HEIGHT - 1, 100, LABEL_HEIGHT - 1);
  assert.deepEqual(
    placeRopeLabels([
      { edges: [top], width: 60, current: null },
      { edges: [below], width: 60, current: null },
    ]),
    [0, 0],
  );
  assert.deepEqual(
    placeRopeLabels([
      { edges: [top], width: 60, current: null },
      { edges: [tooClose], width: 60, current: null },
    ]),
    [0, null],
  );
}

console.log('ropeLabels: all assertions passed');
