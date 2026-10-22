import assert from 'node:assert/strict';
import { fitTransform } from './fitTransform.js';

// 1. A graph wider than the view is scaled down to fit, and centred.
{
  const t = fitTransform([{ x: -500, y: 0, r: 0 }, { x: 500, y: 0, r: 0 }], 400, 800, 0.1, 3, 0);
  assert.equal(t.k, 0.4);
  assert.equal(t.x, 200);
  assert.equal(t.y, 400);
}

// 2. Radii and the margin count towards the size.
{
  const t = fitTransform([{ x: 0, y: 0, r: 50 }], 300, 300, 0.1, 3, 50);
  assert.equal(t.k, 2);
  assert.deepEqual([t.x, t.y], [150, 150]);
}

// 3. The scale is clamped: a tiny graph doesn't blow up, a huge one stays at minScale.
{
  assert.equal(fitTransform([{ x: 0, y: 0, r: 1 }], 400, 400, 0.1, 3).k, 3);
  assert.equal(fitTransform([{ x: 0, y: 0, r: 100000 }], 400, 400, 0.15, 3).k, 0.15);
}

// 4. The centre is what's centred, even off the origin.
{
  const t = fitTransform([{ x: 100, y: 200, r: 0 }, { x: 300, y: 400, r: 0 }], 200, 200, 0.1, 3, 0);
  assert.equal(t.k, 1);
  assert.deepEqual([t.x, t.y], [-100, -200]);
}

// 5. No nodes: identity.
{
  assert.deepEqual(fitTransform([], 400, 400, 0.1, 3), { x: 0, y: 0, k: 1 });
}

console.log('fitTransform: all assertions passed');
