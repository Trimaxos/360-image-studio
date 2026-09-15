import test from 'node:test';
import assert from 'node:assert/strict';
import { useProjectStore } from '../stores/project';
import { applyVariantToPanorama } from './apply-variant';
import type { LayerVariant, SelectionDraft } from '../../shared/types';

const selection: SelectionDraft = {
  sourceView: 'flat',
  mode: 'free-select',
  rect: { x: 0, y: 0, width: 100, height: 100 },
  viewport: { width: 800, height: 600 },
  tileCoords: { x: 10, y: 20, w: 400, h: 300 },
  viewPose: { yaw: 0, pitch: 0, roll: 0, fov: 90 },
  prompt: '',
};

const variant: LayerVariant = {
  id: 'v1',
  resultImageId: 'hash1',
  source: 'ai-generated',
  applied: false,
  width: 400,
  height: 300,
  createdAt: 1,
};

function makeDraftFlatLayer(): string {
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('/tmp/flat.jpg', 1920, 1080);
  useProjectStore.getState().createPerspectiveLayer(selection, '', 400, 300);
  const layerId = useProjectStore.getState().activeLayerId!;
  useProjectStore.getState().addVariantToLayer(layerId, { ...variant });
  useProjectStore.getState().selectVariantForEditing(layerId, variant.id);
  return layerId;
}

// Regression: leaving the canvas without typing a prompt (dirty=false, e.g.
// right after Import) skipped the commit, so the applied variant stayed a
// draft layer and never rendered in the view preview.
test('applying a flat variant commits the draft layer so it shows in the view', async () => {
  const layerId = makeDraftFlatLayer();
  await applyVariantToPanorama(layerId, variant.id);
  const layer = useProjectStore.getState().layers.find((item) => item.id === layerId)!;
  assert.equal(layer.status, 'committed');
  assert.equal(layer.variants?.find((item) => item.id === variant.id)?.applied, true);
});

test('applying an already committed flat variant is a no-op', async () => {
  const layerId = makeDraftFlatLayer();
  await applyVariantToPanorama(layerId, variant.id);
  const before = useProjectStore.getState().layers.find((item) => item.id === layerId);
  await applyVariantToPanorama(layerId, variant.id);
  const after = useProjectStore.getState().layers.find((item) => item.id === layerId);
  assert.deepEqual(after, before);
});
