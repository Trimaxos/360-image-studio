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
  assert.equal(state.hasUnsavedChanges, true);
});

test('saving the project clears the unsaved marker until the next change', () => {
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('/tmp/pano.jpg', 4000, 2000);
  useProjectStore.getState().markProjectSaved();
  assert.equal(useProjectStore.getState().hasUnsavedChanges, false);

  useProjectStore.getState().updateViewPose({ yaw: 15 });
  assert.equal(useProjectStore.getState().hasUnsavedChanges, true);
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

test('cannot switch to another layer while editing', () => {
  const makeLayer = (id: string, order: number): Layer => ({
    id, order, type: 'flat', visible: true,
    yaw: 0, pitch: 0, roll: 0, fov: 90,
    tileCoords: { x: 0, y: 0, w: 10, h: 10 },
    maskData: [], prompt: '', resultImageId: id, status: 'committed',
  });
  useProjectStore.setState({
    workflow: 'canvas-edit',
    layers: [makeLayer('active', 1), makeLayer('other', 2)],
    activeLayerId: 'active',
  });

  useProjectStore.getState().openLayerEditor('other');

  assert.equal(useProjectStore.getState().activeLayerId, 'active');
  assert.equal(useProjectStore.getState().workflow, 'canvas-edit');
});

test('selecting Original turns off every generated variant', () => {
  const layer: Layer = {
    id: 'layer', order: 1, type: 'flat', visible: true,
    yaw: 0, pitch: 0, roll: 0, fov: 90,
    tileCoords: { x: 0, y: 0, w: 10, h: 10 },
    maskData: [], prompt: '', resultImageId: 'original', status: 'committed',
    variants: [
      {
        id: 'ai', resultImageId: 'generated', source: 'ai-generated', applied: true,
        width: 10, height: 10, createdAt: 1,
      },
    ],
  };
  useProjectStore.setState({ layers: [layer], selectedVariantId: 'ai' });

  useProjectStore.getState().selectOriginalVariant('layer');

  assert.equal(useProjectStore.getState().layers[0].variants?.[0].applied, false);
  assert.equal(useProjectStore.getState().selectedVariantId, null);
});

test('clicking the selected variant again deselects it and shows Original', () => {
  const layer: Layer = {
    id: 'layer', order: 1, type: 'flat', visible: true,
    yaw: 0, pitch: 0, roll: 0, fov: 90,
    tileCoords: { x: 0, y: 0, w: 10, h: 10 },
    maskData: [], prompt: '', resultImageId: 'original', status: 'committed',
    variants: [
      {
        id: 'ai', resultImageId: 'generated', source: 'ai-generated', applied: true,
        width: 10, height: 10, createdAt: 1,
      },
    ],
  };
  useProjectStore.setState({ layers: [layer] });

  useProjectStore.getState().selectVariantForEditing('layer', 'ai');

  assert.equal(useProjectStore.getState().layers[0].variants?.[0].applied, false);
});

test('switching variants never reuses the previous panorama cache', () => {
  const layer: Layer = {
    id: 'layer', order: 1, type: 'perspective', visible: true,
    yaw: 0, pitch: 0, roll: 0, fov: 90,
    tileCoords: { x: 0, y: 0, w: 10, h: 10 },
    maskData: [], prompt: '', resultImageId: 'original', status: 'committed',
    equirectImageId: 'people-panorama',
    variants: [
      {
        id: 'no-people', resultImageId: 'arch-only', source: 'ai-generated', applied: false,
        width: 10, height: 10, createdAt: 1,
      },
      {
        id: 'people', resultImageId: 'arch-people', source: 'ai-generated', applied: true,
        equirectImageId: 'people-panorama', width: 10, height: 10, createdAt: 2,
      },
    ],
  };
  useProjectStore.setState({ layers: [layer] });

  useProjectStore.getState().selectVariantForEditing('layer', 'no-people');

  const updated = useProjectStore.getState().layers[0];
  assert.equal(updated.equirectImageId, undefined);
  assert.equal(updated.variants?.find((variant) => variant.id === 'no-people')?.applied, true);
  assert.equal(updated.variants?.find((variant) => variant.id === 'people')?.applied, false);
});

test('committing a manual fit replaces the variant image and clears the flag', () => {
  const layer: Layer = {
    id: 'layer', order: 1, type: 'flat', visible: true,
    yaw: 0, pitch: 0, roll: 0, fov: 90,
    tileCoords: { x: 0, y: 0, w: 10, h: 10 },
    maskData: [], prompt: '', resultImageId: 'original', status: 'committed',
    variants: [
      {
        id: 'imported', resultImageId: 'full-size', source: 'imported', applied: true,
        width: 20, height: 10, needsFit: true, createdAt: 1,
      },
    ],
  };
  useProjectStore.setState({ layers: [layer] });

  useProjectStore.getState().updateVariantResult('layer', 'imported', {
    resultImageId: 'cropped', width: 10, height: 10,
  });

  const updated = useProjectStore.getState().layers[0].variants?.[0];
  assert.equal(updated?.resultImageId, 'cropped');
  assert.equal(updated?.width, 10);
  assert.equal(updated?.height, 10);
  assert.equal(updated?.needsFit, false);
});
