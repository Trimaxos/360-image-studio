import test from 'node:test';
import assert from 'node:assert/strict';
import type { LayerVariant, SelectionDraft } from '../../shared/types';
import { useProjectStore } from '../stores/project';
import { api } from './api';
import { applyVariantToPanorama } from './apply-variant';

const selection = (sourceView: '360' | 'flat'): SelectionDraft => ({
  sourceView,
  mode: 'free-select',
  rect: { x: 0, y: 0, width: 100, height: 100 },
  viewport: { width: 800, height: 600 },
  tileCoords: { x: 10, y: 20, w: 400, h: 300 },
  viewPose: { yaw: 0, pitch: 0, roll: 0, fov: 90 },
  prompt: '',
});

const variant = (id: string, patch: Partial<LayerVariant> = {}): LayerVariant => ({
  id, resultImageId: `result-${id}`, source: 'ai-generated', applied: false, width: 400, height: 300, createdAt: 1, ...patch,
});

/** A layer of the open image, in the editor, with the given results. */
function makeLayer(sourceView: '360' | 'flat', variants: LayerVariant[]): string {
  const store = useProjectStore.getState();
  store.reset();
  store.openImage('/tmp/pano.jpg', 4000, 2000);
  store.createPerspectiveLayer(selection(sourceView), 'tile', 400, 300);
  const layerId = useProjectStore.getState().activeLayerId!;
  for (const item of variants) useProjectStore.getState().addVariantToLayer(layerId, item);
  return layerId;
}
const layerOf = (id: string) => useProjectStore.getState().layers.find((layer) => layer.id === id)!;

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('applying a flat result commits the draft layer, with no reprojection', async (t) => {
  const reproject = t.mock.method(api.image, 'reproject', async () => ({ equirectImageId: 'never' }));
  const layerId = makeLayer('flat', [variant('v1'), variant('v2')]);

  await applyVariantToPanorama(layerId, 'v1');

  const layer = layerOf(layerId);
  assert.equal(layer.status, 'committed');
  assert.deepEqual(layer.variants?.map((item) => [item.id, item.applied]), [['v1', true], ['v2', false]]);
  assert.equal(reproject.mock.callCount(), 0);
});

test('applying a 360 result reprojects it, writes only when the server is done, and leaves the workflow alone', async (t) => {
  const mask = { base64Mask: 'bWFzaw==', brushSize: 10, brushSoftness: 0 };
  const pending = deferred<{ equirectImageId: string }>();
  const reproject = t.mock.method(api.image, 'reproject', () => pending.promise);
  const layerId = makeLayer('360', [variant('v1', { visibilityMask: mask })]);
  useProjectStore.getState().openLayerEditor(layerId);
  const workflow = useProjectStore.getState().workflow;

  const applying = applyVariantToPanorama(layerId, 'v1');
  await tick();

  assert.equal(reproject.mock.callCount(), 1);
  assert.deepEqual(reproject.mock.calls[0].arguments[0], {
    resultImageId: 'result-v1', selection: layerOf(layerId).selection, imagePath: '/tmp/pano.jpg',
    maskEnabled: false, maskData: [], visibilityMask: mask,
  });
  assert.equal(useProjectStore.getState().applyingLayerId, layerId);
  const midway = layerOf(layerId);
  assert.equal(midway.status, 'draft', 'nothing is written while the server works');
  assert.deepEqual(midway.variants?.map((item) => item.applied), [false]);
  assert.equal(midway.equirectImageId, undefined);
  assert.equal(useProjectStore.getState().workflow, workflow);

  pending.resolve({ equirectImageId: 'equirect-v1' });
  await applying;

  const done = layerOf(layerId);
  assert.equal(done.status, 'committed');
  assert.equal(done.equirectImageId, 'equirect-v1');
  assert.deepEqual(done.variants?.map((item) => [item.applied, item.equirectImageId]), [[true, 'equirect-v1']]);
  assert.equal(useProjectStore.getState().applyingLayerId, null);
  assert.equal(useProjectStore.getState().workflow, workflow, 'the app is not put in a "generating" state');
});

test('applying another result swaps the 360 view only when the new one is ready', async (t) => {
  const pending = deferred<{ equirectImageId: string }>();
  t.mock.method(api.image, 'reproject', () => pending.promise);
  const layerId = makeLayer('360', [variant('x', { applied: true, equirectImageId: 'equirect-x' }), variant('y')]);
  useProjectStore.getState().updateLayer(layerId, { status: 'committed', equirectImageId: 'equirect-x' });

  const applying = applyVariantToPanorama(layerId, 'y');
  await tick();
  assert.deepEqual(layerOf(layerId).variants?.map((item) => [item.id, item.applied, item.equirectImageId]),
    [['x', true, 'equirect-x'], ['y', false, undefined]], 'x stays on the 360 view meanwhile');
  assert.equal(layerOf(layerId).equirectImageId, 'equirect-x');

  pending.resolve({ equirectImageId: 'equirect-y' });
  await applying;
  assert.deepEqual(layerOf(layerId).variants?.map((item) => [item.id, item.applied, item.equirectImageId]),
    [['x', false, undefined], ['y', true, 'equirect-y']]);
  assert.equal(layerOf(layerId).equirectImageId, 'equirect-y');
});

test('a failed reprojection changes nothing and says why', async (t) => {
  t.mock.method(api.image, 'reproject', async () => { throw new Error('server busy'); });
  const layerId = makeLayer('360', [variant('x', { applied: true, equirectImageId: 'equirect-x' }), variant('y')]);
  useProjectStore.getState().updateLayer(layerId, { status: 'committed', equirectImageId: 'equirect-x' });
  const before = layerOf(layerId);

  await assert.rejects(applyVariantToPanorama(layerId, 'y'), /server busy/);

  assert.deepEqual(layerOf(layerId), before);
  assert.equal(useProjectStore.getState().applyingLayerId, null);
});

test('applying the same result again after its mask changed reprojects again', async (t) => {
  let runs = 0;
  const reproject = t.mock.method(api.image, 'reproject', async () => ({ equirectImageId: `equirect-${++runs}` }));
  const layerId = makeLayer('360', [variant('v1')]);

  await applyVariantToPanorama(layerId, 'v1');
  useProjectStore.getState().updateVariantMask(layerId, 'v1', { base64Mask: 'bmV3', brushSize: 10, brushSoftness: 0 });
  assert.equal(layerOf(layerId).equirectImageId, 'equirect-1', 'the 360 view keeps the old picture until Apply');
  await applyVariantToPanorama(layerId, 'v1');

  assert.equal(reproject.mock.callCount(), 2);
  assert.equal((reproject.mock.calls[1].arguments[0] as any).visibilityMask.base64Mask, 'bmV3');
  assert.equal(layerOf(layerId).equirectImageId, 'equirect-2');
});

test('applying the original takes the layer out of the 360 view, and does nothing for a layer that was never applied', async (t) => {
  const reproject = t.mock.method(api.image, 'reproject', async () => ({ equirectImageId: 'never' }));
  const layerId = makeLayer('360', [variant('x', { applied: true, equirectImageId: 'equirect-x' }), variant('y')]);
  useProjectStore.getState().updateLayer(layerId, { status: 'committed', equirectImageId: 'equirect-x' });

  await applyVariantToPanorama(layerId, null);

  const layer = layerOf(layerId);
  assert.equal(layer.equirectImageId, undefined);
  assert.deepEqual(layer.variants?.map((item) => [item.applied, item.equirectImageId]), [[false, undefined], [false, undefined]]);
  assert.equal(reproject.mock.callCount(), 0);

  const draftId = makeLayer('360', [variant('z')]);
  const layersBefore = useProjectStore.getState().layers;
  await applyVariantToPanorama(draftId, null);
  assert.equal(useProjectStore.getState().layers, layersBefore, 'nothing was applied, nothing changes');
});

test('a result that still needs fitting cannot be applied', async (t) => {
  const reproject = t.mock.method(api.image, 'reproject', async () => ({ equirectImageId: 'never' }));
  const layerId = makeLayer('360', [variant('v1', { needsFit: true })]);

  await assert.rejects(applyVariantToPanorama(layerId, 'v1'), /căn chỉnh/);

  assert.equal(reproject.mock.callCount(), 0);
  assert.equal(layerOf(layerId).status, 'draft');
});

test('a layer deleted while the server works is simply left alone', async (t) => {
  const pending = deferred<{ equirectImageId: string }>();
  t.mock.method(api.image, 'reproject', () => pending.promise);
  const layerId = makeLayer('360', [variant('v1')]);

  const applying = applyVariantToPanorama(layerId, 'v1');
  await tick();
  useProjectStore.getState().removeLayer(layerId);
  pending.resolve({ equirectImageId: 'equirect-v1' });
  await applying;

  assert.deepEqual(useProjectStore.getState().layers, []);
  assert.equal(useProjectStore.getState().applyingLayerId, null);
});

test('only one result is applied at a time', async (t) => {
  const pending = deferred<{ equirectImageId: string }>();
  const reproject = t.mock.method(api.image, 'reproject', () => pending.promise);
  const layerId = makeLayer('360', [variant('v1'), variant('v2')]);

  const first = applyVariantToPanorama(layerId, 'v1');
  await tick();
  await assert.rejects(applyVariantToPanorama(layerId, 'v2'), /Đang áp dụng/);
  assert.equal(reproject.mock.callCount(), 1);

  pending.resolve({ equirectImageId: 'equirect-v1' });
  await first;
});

test('a result deleted while the server works is not written back: the layer stays as it was', async (t) => {
  const pending = deferred<{ equirectImageId: string }>();
  t.mock.method(api.image, 'reproject', () => pending.promise);
  const layerId = makeLayer('360', [variant('v1'), variant('v2')]);

  const applying = applyVariantToPanorama(layerId, 'v1');
  await tick();
  useProjectStore.getState().removeVariantFromLayer(layerId, 'v1');
  pending.resolve({ equirectImageId: 'equirect-v1' });
  await applying;

  const layer = layerOf(layerId);
  assert.equal(layer.status, 'draft', 'a result that is gone does not commit the layer');
  assert.equal(layer.equirectImageId, undefined, 'and leaves no picture on the 360 view');
  assert.deepEqual(layer.variants?.map((item) => [item.id, item.applied, item.equirectImageId]), [['v2', false, undefined]]);
  assert.equal(useProjectStore.getState().applyingLayerId, null);
});
