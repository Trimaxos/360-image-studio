import test from 'node:test';
import assert from 'node:assert/strict';
import {
  containRect,
  dragRect,
  mapViewportRectToImage,
} from './rect-selection';

test('rectangle starts at pointer down and ends at pointer up', () => {
  assert.deepEqual(
    dragRect({ x: 120, y: 80 }, { x: 360, y: 220 }, { x: 0, y: 0, width: 800, height: 500 }),
    { x: 120, y: 80, width: 240, height: 140 },
  );
});

test('reverse drag keeps the two pointer endpoints', () => {
  assert.deepEqual(
    dragRect({ x: 360, y: 220 }, { x: 120, y: 80 }, { x: 0, y: 0, width: 800, height: 500 }),
    { x: 120, y: 80, width: 240, height: 140 },
  );
});

test('flat selection accounts for object-fit contain letterboxing', () => {
  const imageBounds = containRect(
    { width: 1000, height: 800 },
    { width: 2000, height: 1000 },
  );
  assert.deepEqual(imageBounds, { x: 0, y: 150, width: 1000, height: 500 });
  assert.deepEqual(
    mapViewportRectToImage(imageBounds, imageBounds, { width: 2000, height: 1000 }),
    { x: 0, y: 0, w: 2000, h: 1000 },
  );
});
