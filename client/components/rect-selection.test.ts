import test from 'node:test';
import assert from 'node:assert/strict';
import {
  containRect,
  dragRect,
  layerIntersectsSelection,
  mapViewportRectToImage,
} from './rect-selection';
import type { Layer, SelectionDraft } from '../../shared/types';

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

const selectionAt = (yaw: number): SelectionDraft => ({
  sourceView: '360',
  mode: 'free-select',
  rect: { x: 400, y: 250, width: 200, height: 100 },
  viewport: { width: 1000, height: 600 },
  tileCoords: { x: 0, y: 0, w: 200, h: 100 },
  viewPose: { yaw, pitch: 0, roll: 0, fov: 90 },
  prompt: '',
});

const perspectiveLayerAt = (yaw: number): Layer => ({
  id: `layer-${yaw}`,
  order: 1,
  type: 'perspective',
  visible: true,
  yaw,
  pitch: 0,
  roll: 0,
  fov: 90,
  tileCoords: { x: 0, y: 0, w: 200, h: 100 },
  maskData: [],
  prompt: '',
  resultImageId: 'result',
  status: 'committed',
  selection: selectionAt(yaw),
});

test('selection keeps a layer that overlaps the same spherical region', () => {
  assert.equal(
    layerIntersectsSelection(perspectiveLayerAt(0), selectionAt(2), { width: 8000, height: 4000 }),
    true,
  );
});

test('selection skips a layer on the opposite side of the panorama', () => {
  assert.equal(
    layerIntersectsSelection(perspectiveLayerAt(0), selectionAt(180), { width: 8000, height: 4000 }),
    false,
  );
});
