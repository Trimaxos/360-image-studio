import test from 'node:test';
import assert from 'node:assert/strict';
import { projectScreenPoint, calcPerspectiveResolution, lanczos2Weight, isPoleVisible, renderPerspective } from './perspective-projector';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { planPerspectiveCrop } from '../../shared/model-crop';

test('aligned perspective renders exactly the preview canvas and returns its placement', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aligned-perspective-'));
  try {
    const imagePath = path.join(dir, 'source.png');
    await sharp({ create: { width: 800, height: 400, channels: 3, background: '#808080' } }).png().toFile(imagePath);
    const viewport = { width: 800, height: 600 };
    const pose = { yaw: 0, pitch: 0, roll: 0, fov: 90 };
    const rect = { x: 100, y: 100, width: 500, height: 400 };
    const panorama = { width: 800, height: 400 };
    const expected = planPerspectiveCrop(viewport, pose, rect, panorama);
    const result = await renderPerspective(imagePath, pose, viewport, rect, panorama, 1, true);
    assert.equal(result.width, expected.output.width);
    assert.equal(result.height, expected.output.height);
    assert.deepEqual(result.rect, expected.rect);
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.width, expected.output.width);
    assert.equal(meta.height, expected.output.height);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const { cos, sin, tan } = Math;
const radians = (d: number) => d * Math.PI / 180;

function poleVisible(poleSign: 1 | -1, yaw: number, pitch: number, roll: number, fov: number): boolean {
  return isPoleVisible(
    [0, poleSign, 0],
    cos(radians(yaw)), sin(radians(yaw)),
    cos(radians(pitch)), sin(radians(pitch)),
    cos(radians(roll)), sin(radians(roll)),
    1, // aspect (square viewport for simple tests)
    tan(radians(fov) / 2),
  );
}

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
  // Native height 2000 rounds to the nearest exact 4:3 integer pair.
  assert.equal(result.height, 2001);
  assert.equal(result.width, 2668);
});

test('calcPerspectiveResolution free-select on 8K panorama', () => {
  // Rect covering half viewport width, half viewport height
  const result = calcPerspectiveResolution(
    { width: 800, height: 600 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 },
    { x: 200, y: 150, width: 400, height: 300 },
    { width: 8000, height: 4000 },
  );
  // Native height 1000 rounds to the nearest exact 4:3 integer pair.
  assert.equal(result.height, 999);
  assert.equal(result.width, 1332);
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

test('calcPerspectiveResolution default scaleFactor=1 retains the exact ratio', () => {
  const result = calcPerspectiveResolution(
    { width: 800, height: 600 },
    { yaw: 0, pitch: 0, roll: 0, fov: 90 },
    { x: 0, y: 0, width: 800, height: 600 },
    { width: 8000, height: 4000 },
  );
  // Default scaleFactor=1 keeps 4:3 instead of independently rounding edges.
  assert.equal(result.height, 2001);
  assert.equal(result.width, 2668);
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

// ---- isPoleVisible tests ----

test('isPoleVisible: pitch=90° fov=90° → north pole visible, south not', () => {
  assert.equal(poleVisible(1, 0, 90, 0, 90), true);
  assert.equal(poleVisible(-1, 0, 90, 0, 90), false);
});

test('isPoleVisible: pitch=-90° fov=90° → south pole visible, north not', () => {
  assert.equal(poleVisible(-1, 0, -90, 0, 90), true);
  assert.equal(poleVisible(1, 0, -90, 0, 90), false);
});

test('isPoleVisible: pitch=0° fov=70° → neither pole visible', () => {
  assert.equal(poleVisible(1, 0, 0, 0, 70), false);
  assert.equal(poleVisible(-1, 0, 0, 0, 70), false);
});

test('isPoleVisible: pitch=45° fov=120° → north pole visible (pole within 60° half-fov)', () => {
  // Pole at 45° from center, half-FOV = 60° → should be visible
  assert.equal(poleVisible(1, 0, 45, 0, 120), true);
});

test('isPoleVisible: pitch=0° fov=179° → neither pole visible (pole at 90° > 89.5° half-fov)', () => {
  // Half-FOV = 89.5°. The pole is perpendicular to the view axis at 90°,
  // just outside the frustum edge. Visible only with FOV > 180°.
  assert.equal(poleVisible(1, 0, 0, 0, 179), false);
  assert.equal(poleVisible(-1, 0, 0, 0, 179), false);
});

test('isPoleVisible: pole still visible after yaw rotation when pitch=90°', () => {
  // When the camera points straight at the pole (pitch=90°), the view
  // direction aligns with the world Y axis.  Yaw rotation (around Y)
  // therefore does not change the view center — the north pole stays
  // visible regardless of yaw.
  assert.equal(poleVisible(1, 180, 90, 0, 90), true);
});

test('isPoleVisible: pitch=-60 fov=90 - south pole visible, north not (regression for near-pole gap bug)', () => {
  // This is the exact case from the bug: looking down at -60 with a 90 FOV
  // the south pole is well inside the frustum (at NDC 0, -0.577, 0.423 from edge).
  // North pole is behind the camera.
  assert.equal(poleVisible(-1, 0, -60, 0, 90), true);
  assert.equal(poleVisible(1, 0, -60, 0, 90), false);
});

test('isPoleVisible: non-pole view - regression check that normal views are unaffected', () => {
  // Typical viewing angles: looking at the horizon, neither pole visible.
  assert.equal(poleVisible(1, 0, 0, 0, 70), false);
  assert.equal(poleVisible(-1, 0, 0, 0, 70), false);
  assert.equal(poleVisible(1, 45, 10, 0, 50), false);
  assert.equal(poleVisible(-1, 45, 10, 0, 50), false);
});
