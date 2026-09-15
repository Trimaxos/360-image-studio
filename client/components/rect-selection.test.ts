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

// Regression: a selection dragged to the image's bottom/right edge could
// round past the image bounds, so the server crop cut off the last row/column
// (or failed the extract entirely).
test('mapping never returns a crop past the image bounds', () => {
  const image = { width: 100, height: 3 };
  const bounds = { x: 0, y: 0, width: 100, height: 3 };
  const mapped = mapViewportRectToImage({ x: 0, y: 0.5, width: 100, height: 2.5 }, bounds, image);
  assert.ok(
    mapped.y + mapped.h <= image.height,
    `crop bottom ${mapped.y + mapped.h} exceeds image height ${image.height}`,
  );
  assert.ok(
    mapped.x + mapped.w <= image.width,
    `crop right ${mapped.x + mapped.w} exceeds image width ${image.width}`,
  );
});
