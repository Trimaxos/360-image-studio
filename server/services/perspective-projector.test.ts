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
  // outHeight = (600/600) * (90 * 4000 / 180) = 2000
  // outWidth = 2000 * 800 / 600 = 2667
  assert.equal(result.height, 2000);
  assert.equal(result.width, 2667);
});

test('calcPerspectiveResolution free-select on 8K panorama', () => {
  // Rect covering half viewport width, half viewport height
  const result = calcPerspectiveResolution(
    { width: 800, height: 600 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 },
    { x: 200, y: 150, width: 400, height: 300 },
    { width: 8000, height: 4000 },
  );
  // outHeight = (300/600) * (90 * 4000 / 180) = 1000
  // outWidth = 1000 * 400 / 300 = 1333
  assert.equal(result.height, 1000);
  assert.equal(result.width, 1333);
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
