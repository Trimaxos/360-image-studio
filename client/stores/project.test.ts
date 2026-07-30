import test from 'node:test';
import assert from 'node:assert/strict';
import { useProjectStore } from './project';
import type { Layer } from '../../shared/types';

test('opening an image starts viewing at fov 90', () => {
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('/tmp/pano.jpg', 4000, 2000);
  const state = useProjectStore.getState();
  assert.equal(state.workflow, 'viewing');
  assert.equal(state.viewPose.fov, 90);
});

test('leaving canvas clears temporary generated variants', () => {
  useProjectStore.setState({
    workflow: 'canvas-edit',
    generatedVariants: [{ id: 'v1', base64Result: 'abc', modelId: 'model' }],
    selectedVariantId: 'v1',
    dirty: true,
  });
  useProjectStore.getState().leaveCanvas('save');
  const state = useProjectStore.getState();
  assert.equal(state.workflow, 'viewing');
  assert.deepEqual(state.generatedVariants, []);
  assert.equal(state.selectedVariantId, null);
});

test('Back after Apply keeps the committed layer when editor is clean', () => {
  const oldLayer = {
    id: 'layer', order: 1, type: 'flat', visible: true,
    yaw: 0, pitch: 0, roll: 0, fov: 90,
    tileCoords: { x: 0, y: 0, w: 10, h: 10 },
    maskData: [], prompt: 'old', resultImageId: 'old', status: 'committed',
  } satisfies Layer;
  useProjectStore.setState({
    workflow: 'canvas-edit',
    layers: [{ ...oldLayer, prompt: 'applied', resultImageId: 'new' }],
    editSnapshot: { layer: oldLayer, selection: null },
    dirty: false,
  });
  useProjectStore.getState().leaveCanvas('discard');
  assert.equal(useProjectStore.getState().layers[0].resultImageId, 'new');
});
