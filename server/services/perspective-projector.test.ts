import test from 'node:test';
import assert from 'node:assert/strict';
import { projectScreenPoint, calcPerspectiveResolution } from './perspective-projector';

test('center of a yaw zero view maps to panorama center', () => {
  const point = projectScreenPoint(
    { x: 500, y: 250 },
    { width: 1000, height: 500 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 },
    { width: 4000, height: 2000 },
  );
  assert.ok(Math.abs(point.x - 2000) < 1);
  assert.ok(Math.abs(point.y - 1000) < 1);
});

test('positive ninety degree yaw maps to three-quarter panorama', () => {
  const point = projectScreenPoint(
    { x: 500, y: 250 },
    { width: 1000, height: 500 },
    { yaw: 90, pitch: 0, roll: 0, fov: 90 },
    { width: 4000, height: 2000 },
  );
  assert.ok(Math.abs(point.x - 3000) < 1);
});

test('calcPerspectiveResolution full-frame on 8K panorama at 90° FOV', () => {
  const result = calcPerspectiveResolution(
    { width: 800, height: 600 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 },
    { x: 0, y: 0, width: 800, height: 600 },
    { width: 8000, height: 4000 },
  );
  // hFov_deg = 2 * atan(800/600 * tan(90/2)) * 180/pi
  // = 2 * atan(1.333 * 1) * 180/pi
  // = 2 * 53.13 * 180/pi ≈ 106.26°
  // fullPerspWidth = 106.26 * 8000 / 360 ≈ 2361
  // fullPerspHeight = 90 * 4000 / 180 = 2000
  assert.ok(Math.abs(result.width - 2361) < 5, `width=${result.width}`);
  assert.equal(result.height, 2000);
});

test('calcPerspectiveResolution free-select on 8K panorama', () => {
  // Rect covering half viewport width, half viewport height
  const result = calcPerspectiveResolution(
    { width: 800, height: 600 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 },
    { x: 200, y: 150, width: 400, height: 300 },
    { width: 8000, height: 4000 },
  );
  // Full perspective: ~2361 × 2000
  // Rect = 50% of viewport in both axes → ~1181 × 1000
  assert.ok(Math.abs(result.width - 1181) < 5, `width=${result.width}`);
  assert.equal(result.height, 1000);
});

test('calcPerspectiveResolution with narrow FOV produces smaller output', () => {
  const wide = calcPerspectiveResolution(
    { width: 800, height: 600 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 },
    { x: 0, y: 0, width: 800, height: 600 },
    { width: 8000, height: 4000 },
  );
  const narrow = calcPerspectiveResolution(
    { width: 800, height: 600 },
    { yaw: 0, pitch: 0, roll: 0, fov: 30 },
    { x: 0, y: 0, width: 800, height: 600 },
    { width: 8000, height: 4000 },
  );
  // Narrow FOV = less of the panorama visible = smaller output
  assert.ok(narrow.width < wide.width);
  assert.ok(narrow.height < wide.height);
});
