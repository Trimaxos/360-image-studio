import test from 'node:test';
import assert from 'node:assert/strict';
import { projectScreenPoint, calcPerspectiveResolution, lanczos2Weight } from './perspective-projector';

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

test('calcPerspectiveResolution with scaleFactor=1.5 on 8K panorama', () => {
  const result = calcPerspectiveResolution(
    { width: 800, height: 600 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 },
    { x: 0, y: 0, width: 800, height: 600 },
    { width: 8000, height: 4000 },
    1.5,
  );
  // base height = 2000, ×1.5 = 3000
  // width = 3000 × 800/600 = 4000
  assert.equal(result.height, 3000);
  assert.equal(result.width, 4000);
});

test('calcPerspectiveResolution default scaleFactor=1 matches legacy', () => {
  const result = calcPerspectiveResolution(
    { width: 800, height: 600 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 },
    { x: 0, y: 0, width: 800, height: 600 },
    { width: 8000, height: 4000 },
  );
  // Default scaleFactor=1: height = 2000, width = 2667
  assert.equal(result.height, 2000);
  assert.equal(result.width, 2667);
});

// ---- Lanczos2 (a=2) kernel tests ----

test('lanczos2Weight at origin is 1', () => {
  assert.equal(lanczos2Weight(0), 1);
});

test('lanczos2Weight at integer distances', () => {
  // At x=1, sinc(π) = 0/(π) = 0 → weight = 0
  assert.ok(Math.abs(lanczos2Weight(1)) < 1e-10);
  // At x=2, exactly at support boundary → 0
  assert.equal(lanczos2Weight(2), 0);
  // Beyond support → 0
  assert.equal(lanczos2Weight(3), 0);
  assert.equal(lanczos2Weight(-2.5), 0);
});

test('lanczos2Weight symmetry', () => {
  assert.equal(lanczos2Weight(0.5), lanczos2Weight(-0.5));
  assert.equal(lanczos2Weight(1.5), lanczos2Weight(-1.5));
});

test('lanczos2Weight decays from origin', () => {
  const w0 = lanczos2Weight(0);
  const w1 = lanczos2Weight(0.8);
  const w2 = lanczos2Weight(1.6);
  assert.ok(w1 < w0);
  assert.ok(Math.abs(w2) < Math.abs(w1));
});
