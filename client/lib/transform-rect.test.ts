import { test } from 'node:test';
import assert from 'node:assert';
import { MIN_TRANSFORM_SIZE, moveRect, resizeRect } from './transform-rect';

const RECT = { left: 0, top: 0, right: 100, bottom: 50 };

test('moveRect shifts the image freely on both axes', () => {
  assert.deepEqual(moveRect(RECT, 10, -5), { left: 10, top: -5, right: 110, bottom: 45 });
});

test('edge handles stretch a single axis (free horizontal/vertical resize)', () => {
  assert.deepEqual(resizeRect(RECT, 'e', { x: 150, y: 25 }), { left: 0, top: 0, right: 150, bottom: 50 });
  assert.deepEqual(resizeRect(RECT, 's', { x: 50, y: 90 }), { left: 0, top: 0, right: 100, bottom: 90 });
  assert.deepEqual(resizeRect(RECT, 'w', { x: -40, y: 25 }), { left: -40, top: 0, right: 100, bottom: 50 });
  assert.deepEqual(resizeRect(RECT, 'n', { x: 50, y: -20 }), { left: 0, top: -20, right: 100, bottom: 50 });
});

test('corner handles stretch both axes freely by default', () => {
  assert.deepEqual(resizeRect(RECT, 'se', { x: 120, y: 80 }), { left: 0, top: 0, right: 120, bottom: 80 });
});

test('shift + corner keeps the original aspect ratio anchored at the opposite corner', () => {
  const next = resizeRect(RECT, 'se', { x: 300, y: 60 }, true);
  assert.equal(next.left, 0);
  assert.equal(next.top, 0);
  assert.equal(next.right - next.left, 300);
  assert.equal(next.bottom - next.top, 150);

  // scaleY (0.6) dominates scaleX (0.5) → 60×30, anchored at the opposite corner
  const nw = resizeRect(RECT, 'nw', { x: 50, y: 20 }, true);
  assert.equal(nw.right, 100);
  assert.equal(nw.bottom, 50);
  assert.equal(nw.right - nw.left, 60);
  assert.equal(nw.bottom - nw.top, 30);
});

test('resizing cannot invert or shrink below the minimum size', () => {
  const right = resizeRect(RECT, 'e', { x: -50, y: 25 });
  assert.equal(right.right - right.left, MIN_TRANSFORM_SIZE);
  const left = resizeRect(RECT, 'w', { x: 500, y: 25 });
  assert.equal(left.right - left.left, MIN_TRANSFORM_SIZE);
  const bottom = resizeRect(RECT, 's', { x: 50, y: -100 });
  assert.equal(bottom.bottom - bottom.top, MIN_TRANSFORM_SIZE);
});
