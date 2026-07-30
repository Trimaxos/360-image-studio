import test from 'node:test';
import assert from 'node:assert/strict';
import { coverSourceRect } from './canvas-exchange';

test('manual result with matching aspect ratio uses the full image', () => {
  assert.deepEqual(
    coverSourceRect({ width: 800, height: 600 }, { width: 400, height: 300 }),
    { sx: 0, sy: 0, sw: 800, sh: 600 },
  );
});

test('manual result is center-cropped when its aspect ratio differs', () => {
  assert.deepEqual(
    coverSourceRect({ width: 1000, height: 1000 }, { width: 800, height: 400 }),
    { sx: 0, sy: 250, sw: 1000, sh: 500 },
  );
});
