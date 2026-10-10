import test from 'node:test';
import assert from 'node:assert/strict';
import { brushAlpha, compositeStroke, createStrokeBuffer, stampStroke, stepBrushSize, unionRect } from './brush-stroke';

test('alpha is solid inside the inner circle and fades smoothly to zero at the outer circle', () => {
  assert.equal(brushAlpha(0, 50, 60), 1);
  assert.equal(brushAlpha(30, 50, 60), 1);          // inner radius = 30
  assert.equal(brushAlpha(50, 50, 60), 0);
  assert.equal(brushAlpha(80, 50, 60), 0);
  const mid = brushAlpha(40, 50, 60);
  assert.ok(mid > 0.4 && mid < 0.6, `half way through the fade: ${mid}`);
  let previous = 1;
  for (let d = 30; d <= 50; d += 1) {
    const alpha = brushAlpha(d, 50, 60);
    assert.ok(alpha <= previous + 1e-12, `monotonic at ${d}`);
    previous = alpha;
  }
});

test('hardness 100 is a crisp edge one pixel wide (not a staircase), hardness 0 fades from the centre, tiny radii never give NaN', () => {
  assert.equal(brushAlpha(0, 50, 100), 1);
  assert.equal(brushAlpha(48.9, 50, 100), 1, 'solid up to one pixel inside the outer circle');
  assert.ok(Math.abs(brushAlpha(49.5, 50, 100) - 0.5) < 1e-9, 'half way across the last pixel');
  assert.equal(brushAlpha(50, 50, 100), 0);
  assert.ok(brushAlpha(1, 50, 0) < 1 && brushAlpha(1, 50, 0) > 0.99);
  assert.ok(brushAlpha(25, 50, 0) > 0.4 && brushAlpha(25, 50, 0) < 0.6);
  for (const value of [brushAlpha(0, 0.4, 50), brushAlpha(1, 0.4, 0), brushAlpha(0, 1, 100)]) assert.ok(Number.isFinite(value));
});

test('overlapping dabs keep the profile of one dab (max, not accumulation)', () => {
  const buffer = createStrokeBuffer(200, 100);
  for (let x = 40; x <= 160; x += 5) stampStroke(buffer, x, 50, 30, 0);
  // Pixel (100, 50 + dy) has its centre at (100.5, 50.5 + dy); the nearest dab (x = 100) alone decides its value.
  for (const dy of [0, 10, 20, 28]) {
    const alpha = buffer.alpha[(50 + dy) * 200 + 100];
    const single = brushAlpha(Math.hypot(0.5, dy + 0.5), 30, 0);
    assert.ok(Math.abs(alpha - single) < 1e-5, `dy ${dy}: ${alpha} vs one dab ${single}`);
  }
  assert.ok(buffer.alpha[(50 + 20) * 200 + 100] < 0.3, 'the soft edge survives 25 overlapping dabs');
});

test('dabs near the canvas edge are clipped and report the clipped dirty rectangle', () => {
  const buffer = createStrokeBuffer(50, 40);
  const rect = stampStroke(buffer, 2, 38, 10, 50)!;
  assert.deepEqual(rect, { x: 0, y: 28, width: 13, height: 12 });
  assert.equal(stampStroke(buffer, -100, -100, 10, 50), null);
  assert.deepEqual(unionRect(rect, { x: 40, y: 0, width: 10, height: 5 }), { x: 0, y: 0, width: 50, height: 40 });
  assert.deepEqual(unionRect(null, rect), rect);
});

test('opacity caps one stroke: many overlapping dabs at 50% never pass 50%', () => {
  const width = 60, height = 20;
  const white = new Uint8ClampedArray(width * height * 4).fill(255);
  const target = white.slice();
  const buffer = createStrokeBuffer(width, height);
  let dirty = null;
  for (let i = 0; i < 40; i++) dirty = unionRect(dirty, stampStroke(buffer, 30, 10, 8, 100));
  compositeStroke(white, target, buffer, dirty!, 'erase', 50);
  const centre = (10 * width + 30) * 4;
  assert.ok(Math.abs(target[centre] - 128) <= 1, `erase 50% of white: ${target[centre]}`);
  assert.equal(target[centre + 3], 255, 'alpha channel untouched');
  const black = new Uint8ClampedArray(width * height * 4).map((_, i) => (i % 4 === 3 ? 255 : 0));
  const restored = black.slice();
  compositeStroke(black, restored, buffer, dirty!, 'restore', 100);
  assert.equal(restored[centre], 255);
  assert.equal(restored[0], 0, 'outside the stroke stays as the base');
});

test('[ and ] always move the brush size by at least one pixel, so small sizes never get stuck, and it stays within 1..300', () => {
  let size = 1;
  while (size < 300) {
    const next = stepBrushSize(size, true);
    assert.ok(next > size, `] from ${size} gave ${next}`);
    size = next;
  }
  assert.equal(size, 300);
  assert.equal(stepBrushSize(300, true), 300);
  while (size > 1) {
    const next = stepBrushSize(size, false);
    assert.ok(next < size, `[ from ${size} gave ${next}`);
    size = next;
  }
  assert.equal(stepBrushSize(1, false), 1);
  assert.equal(stepBrushSize(80, true), 88, 'ordinary sizes still grow by about 10%');
  assert.equal(stepBrushSize(88, false), 80);
});
