import test from 'node:test';
import assert from 'node:assert/strict';
import {
  containRect,
  dragRect,
  mapViewportRectToImage,
  planAlignedSelection,
} from './rect-selection';

test('rectangle starts at pointer down and ends at pointer up', () => {
  assert.deepEqual(
    dragRect({ x: 120, y: 80 }, { x: 360, y: 220 }, { x: 0, y: 0, width: 800, height: 500 }),
    { x: 120, y: 80, width: 240, height: 140 },
  );
});

test('flat preview and stored tile use native pixels despite viewport scaling', () => {
  const plan = planAlignedSelection('flat', { x: 0, y: 75, width: 500, height: 350 },
    { width: 500, height: 500 }, { width: 1000, height: 700 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 });
  assert.deepEqual(plan.tileCoords, { x: 4, y: 6, w: 992, h: 688 });
  assert.deepEqual(plan.rect, { x: 2, y: 78, width: 496, height: 344 });
  assert.deepEqual(plan.output, { width: 992, height: 688 });
});

test('aligned flat crop stays inside fractional drag edges', () => {
  const rect = { x: 0.2, y: 0.2, width: 992.1, height: 688.1 };
  const plan = planAlignedSelection('flat', rect, { width: 1000, height: 700 },
    { width: 1000, height: 700 }, { yaw: 0, pitch: 0, roll: 0, fov: 90 });
  assert.ok(plan.rect.x >= rect.x && plan.rect.y >= rect.y);
  assert.ok(plan.rect.x + plan.rect.width <= rect.x + rect.width);
  assert.ok(plan.rect.y + plan.rect.height <= rect.y + rect.height);
});

test('small crop preview maps the exact native crop back to original placement', () => {
  const plan = planAlignedSelection('flat', { x: 100, y: 100, width: 976, height: 544 },
    { width: 1200, height: 900 }, { width: 1200, height: 900 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 });
  assert.deepEqual(plan.tileCoords, { x: 112, y: 106, w: 952, h: 532 });
  assert.deepEqual(plan.rect, { x: 112, y: 106, width: 952, height: 532 });
  assert.deepEqual(plan.output, { width: 1088, height: 608 });
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
