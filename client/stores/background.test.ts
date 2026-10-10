import test from 'node:test';
import assert from 'node:assert/strict';
import type { Layer, LayerVariant, SelectionDraft } from '../../shared/types';
import { useProjectStore } from './project';

const selection = (prompt = 'p'): SelectionDraft => ({
  sourceView: '360',
  mode: 'free-select',
  rect: { x: 0, y: 0, width: 100, height: 100 },
  viewport: { width: 1120, height: 761 },
  tileCoords: { x: 0, y: 0, w: 640, h: 480 },
  viewPose: { yaw: 10, pitch: 5, roll: 0, fov: 60 },
  prompt,
});

const variant = (id: string, patch: Partial<LayerVariant> = {}): LayerVariant => ({
  id, resultImageId: `result-${id}`, source: 'ai-generated', applied: false, width: 100, height: 80, createdAt: 1, ...patch,
});

const layerWith = (variants: LayerVariant[], patch: Partial<Layer> = {}): Layer => ({
  id: 'layer', order: 1, type: 'perspective', visible: true,
  yaw: 0, pitch: 0, roll: 0, fov: 60,
  tileCoords: { x: 0, y: 0, w: 100, h: 80 },
  maskData: [], prompt: '', resultImageId: 'original', status: 'draft', variants, ...patch,
});

function fresh() {
  const store = useProjectStore.getState();
  store.reset();
  store.openImage('a.jpg', 10000, 5000);
}

test('looking at another result changes nothing in the layers, so the 360 view cannot move', () => {
  fresh();
  const layer = layerWith(
    [variant('a', { applied: true, equirectImageId: 'eq-a' }), variant('b')],
    { equirectImageId: 'eq-a', status: 'committed' },
  );
  useProjectStore.setState({ layers: [layer], activeLayerId: layer.id, reviewVariantId: 'a', selectedVariantId: 'preview' });
  const before = useProjectStore.getState().layers;

  useProjectStore.getState().setReviewVariant('b');
  assert.equal(useProjectStore.getState().reviewVariantId, 'b');
  assert.equal(useProjectStore.getState().selectedVariantId, null, 'the temporary preview goes away');
  assert.equal(useProjectStore.getState().layers, before, 'same layers, untouched');

  useProjectStore.getState().setReviewVariant(null);
  assert.equal(useProjectStore.getState().reviewVariantId, null, 'null is the original');
  assert.equal(useProjectStore.getState().layers, before);
});

test('opening a layer looks at the applied result, else the newest, else the original', () => {
  fresh();
  const withApplied = layerWith(
    [variant('old', { createdAt: 1 }), variant('applied', { applied: true, createdAt: 2 }), variant('new', { createdAt: 3 })],
    { id: 'with-applied', order: 1 },
  );
  const onlyResults = layerWith([variant('first', { createdAt: 1 }), variant('second', { createdAt: 2 })], { id: 'only-results', order: 2 });
  const sameSecond = layerWith([variant('x', { createdAt: 5 }), variant('y', { createdAt: 5 })], { id: 'same-second', order: 3 });
  const empty = layerWith([], { id: 'empty', order: 4 });
  useProjectStore.setState({ layers: [withApplied, onlyResults, sameSecond, empty] });

  for (const [id, expected] of [['with-applied', 'applied'], ['only-results', 'second'], ['same-second', 'y'], ['empty', null]] as const) {
    useProjectStore.setState({ workflow: 'viewing', activeLayerId: null });
    useProjectStore.getState().openLayerEditor(id);
    assert.equal(useProjectStore.getState().reviewVariantId, expected, id);
  }
});

test('a new layer starts on the original and every way out of the editor forgets what was being looked at', () => {
  fresh();
  useProjectStore.getState().createPerspectiveLayer(selection(), 'tile', 100, 80);
  assert.equal(useProjectStore.getState().reviewVariantId, null);
  for (const choice of ['keep', 'save', 'discard'] as const) {
    useProjectStore.setState({ workflow: 'canvas-edit', reviewVariantId: 'something' });
    useProjectStore.getState().leaveCanvas(choice);
    assert.equal(useProjectStore.getState().reviewVariantId, null, choice);
  }
});

test('editing the mask or the fit of the applied result leaves the 360 view as it was until Apply', () => {
  fresh();
  const layer = layerWith(
    [variant('a', { applied: true, equirectImageId: 'eq-a', needsFit: true })],
    { equirectImageId: 'eq-a', status: 'committed' },
  );
  useProjectStore.setState({ layers: [layer] });

  useProjectStore.getState().updateVariantMask(layer.id, 'a', { base64Mask: 'mask', brushSize: 10, brushSoftness: 0 });
  let updated = useProjectStore.getState().layers[0];
  assert.equal(updated.equirectImageId, 'eq-a');
  assert.equal(updated.variants?.[0].equirectImageId, 'eq-a');
  assert.equal(updated.variants?.[0].applied, true);
  assert.equal(updated.variants?.[0].visibilityMask?.base64Mask, 'mask');

  useProjectStore.getState().updateVariantResult(layer.id, 'a', { resultImageId: 'cropped', width: 10, height: 10 });
  updated = useProjectStore.getState().layers[0];
  assert.equal(updated.equirectImageId, 'eq-a');
  assert.equal(updated.variants?.[0].equirectImageId, 'eq-a');
  assert.equal(updated.variants?.[0].applied, true);
  assert.equal(updated.variants?.[0].resultImageId, 'cropped');
  assert.equal(updated.variants?.[0].needsFit, false);
});

test('Back keeps everything: prompt and selection are stored, the layer stays a draft, results and runs stay', () => {
  fresh();
  const layer = layerWith([variant('a'), variant('b')], { id: 'L', prompt: 'old', status: 'draft' });
  useProjectStore.setState({
    layers: [layer],
    activeLayerId: 'L',
    workflow: 'canvas-edit',
    selectionDraft: selection('new prompt'),
    generatedVariants: [{ id: 'g', base64Result: 'x', modelId: 'm' }],
    selectedVariantId: 'g',
    reviewVariantId: 'b',
    generations: { L: { status: 'running', startedAt: 1 }, other: { status: 'queued', startedAt: 2 } },
    dirty: true,
  });

  useProjectStore.getState().leaveCanvas('keep');

  const state = useProjectStore.getState();
  const kept = state.layers[0];
  assert.equal(kept.status, 'draft', 'Back does not commit anything');
  assert.equal(kept.prompt, 'new prompt');
  assert.equal(kept.selection?.prompt, 'new prompt');
  assert.deepEqual(kept.variants, layer.variants, 'the results are all still there');
  assert.equal(state.workflow, 'viewing');
  assert.equal(state.activeLayerId, null);
  assert.deepEqual(state.generatedVariants, []);
  assert.equal(state.reviewVariantId, null);
  assert.deepEqual(state.generations, { L: { status: 'running', startedAt: 1 }, other: { status: 'queued', startedAt: 2 } });
});

test('Back never touches the result that is applied to the 360 view, whatever was being looked at', () => {
  fresh();
  const layer = layerWith(
    [variant('a', { applied: true, equirectImageId: 'eq-a' }), variant('b')],
    { id: 'L', status: 'committed', equirectImageId: 'eq-a' },
  );
  useProjectStore.setState({
    layers: [layer], activeLayerId: 'L', workflow: 'canvas-edit', selectionDraft: selection('p'), reviewVariantId: 'b',
  });

  useProjectStore.getState().leaveCanvas('keep');

  const kept = useProjectStore.getState().layers[0];
  assert.equal(kept.status, 'committed');
  assert.equal(kept.equirectImageId, 'eq-a');
  assert.deepEqual(kept.variants?.map((item) => [item.id, item.applied, item.equirectImageId]), [['a', true, 'eq-a'], ['b', false, undefined]]);
});

test('generations are kept per layer and cleared with the layer, the image and the project', () => {
  fresh();
  const one = layerWith([], { id: 'one', order: 1 });
  const two = layerWith([], { id: 'two', order: 2 });
  useProjectStore.setState({ layers: [one, two] });

  useProjectStore.getState().setGeneration('one', { status: 'running', startedAt: 1 });
  useProjectStore.getState().setGeneration('two', { status: 'queued', startedAt: 2 });
  assert.deepEqual(Object.keys(useProjectStore.getState().generations), ['one', 'two']);

  useProjectStore.getState().setGeneration('one', null);
  assert.deepEqual(Object.keys(useProjectStore.getState().generations), ['two']);

  useProjectStore.getState().removeLayer('two');
  assert.deepEqual(useProjectStore.getState().generations, {});

  useProjectStore.getState().setGeneration('x', { status: 'failed', error: 'server busy', startedAt: 3 });
  useProjectStore.getState().setApplyingLayer('x');
  useProjectStore.getState().openImage('b.jpg', 10000, 5000);
  assert.deepEqual(useProjectStore.getState().generations, {});
  assert.equal(useProjectStore.getState().applyingLayerId, null);

  useProjectStore.getState().setGeneration('y', { status: 'running', startedAt: 4 });
  useProjectStore.getState().setApplyingLayer('y');
  useProjectStore.getState().reset();
  assert.deepEqual(useProjectStore.getState().generations, {});
  assert.equal(useProjectStore.getState().applyingLayerId, null);
});

test('deleting the result that is on the 360 view takes the layer out of it; deleting any other result does not', () => {
  fresh();
  const layer = layerWith(
    [variant('a', { applied: true, equirectImageId: 'eq-a' }), variant('b')],
    { equirectImageId: 'eq-a', status: 'committed' },
  );
  useProjectStore.setState({ layers: [layer] });
  const current = () => useProjectStore.getState().layers[0];

  useProjectStore.getState().removeVariantFromLayer('layer', 'b');
  assert.equal(current().equirectImageId, 'eq-a', 'a result that is not on the 360 view is only a result');
  assert.deepEqual(current().variants?.map((item) => [item.id, item.applied]), [['a', true]]);

  useProjectStore.getState().removeVariantFromLayer('layer', 'a');
  assert.equal(current().equirectImageId, undefined, 'the picture of the deleted result leaves the 360 view');
  assert.deepEqual(current().variants, []);
});
