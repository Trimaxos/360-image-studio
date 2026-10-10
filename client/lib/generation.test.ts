import test from 'node:test';
import assert from 'node:assert/strict';
import type { AiModelOption, SelectionDraft } from '../../shared/types';
import { useProjectStore } from '../stores/project';
import { api } from './api';
import { MAX_PARALLEL_GENERATIONS, generationSteps, hasGenerationInFlight, startGeneration } from './generation';

const model = { id: 'cx/gpt-6-astra', provider: 'ninerouter', displayName: 'GPT-6 Astra', enabled: true } as AiModelOption;

const selection = (prompt = ''): SelectionDraft => ({
  sourceView: '360',
  mode: 'free-select',
  rect: { x: 0, y: 0, width: 100, height: 100 },
  viewport: { width: 1120, height: 761 },
  tileCoords: { x: 0, y: 0, w: 640, h: 480 },
  viewPose: { yaw: 10, pitch: 5, roll: 0, fov: 60 },
  prompt,
});

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
/** Lets every awaiting step of the generation chain run until it waits on something we hold. */
async function settle() {
  for (let round = 0; round < 12; round += 1) await new Promise((resolve) => setImmediate(resolve));
}
const aiResult = (name = 'model') => ({ base64Result: 'edited-base64', provider: 'ninerouter', model: name });

/** Fresh image with `count` draft layers; returns their ids. */
function openLayers(count: number, imagePath = 'a.jpg'): string[] {
  const store = useProjectStore.getState();
  store.reset();
  store.openImage(imagePath, 10000, 5000);
  for (let index = 0; index < count; index += 1) {
    useProjectStore.getState().addDraftLayer(selection(`old ${index}`), `tile-${index}`, 640, 480, `Layer ${index}`);
  }
  return useProjectStore.getState().layers.map((layer) => layer.id);
}
const layerOf = (id: string) => useProjectStore.getState().layers.find((layer) => layer.id === id)!;
const statuses = () => Object.fromEntries(Object.entries(useProjectStore.getState().generations).map(([id, item]) => [id, item.status]));
const input = (layerId: string, prompt = 'make it nice') => ({ layerId, prompt, model, referenceImages: [] });

/** Replaces the browser-only and network steps. `edits` collects the AI calls that are waiting for the test to answer them. */
function fakeEverything(t: any) {
  const edits: Array<ReturnType<typeof deferred>> = [];
  const calls: any[] = [];
  let saved = 0;
  t.mock.method(api.ai, 'translate', async (text: string) => ({ translated: `EN:${text}`, detectedLanguage: 'vi' }));
  t.mock.method(api.ai, 'edit', (body: any) => { calls.push(body); const edit = deferred(); edits.push(edit); return edit.promise; });
  t.mock.method(api.image, 'saveResultCache', async () => ({ resultImageId: `cache-${++saved}`, sizeBytes: 1 }));
  const sourceImage = t.mock.method(generationSteps, 'sourceImage', async () => 'source-base64');
  const whiteMask = t.mock.method(generationSteps, 'whiteMask', async () => 'white-mask');
  const blend = t.mock.method(generationSteps, 'blend', async () => 'blended-base64');
  return { edits, calls, sourceImage, whiteMask, blend };
}

test('four generations run at the same time and the fifth waits for a free place', async (t) => {
  const fake = fakeEverything(t);
  const ids = openLayers(5);

  for (const id of ids) startGeneration(input(id));
  await settle();

  assert.equal(MAX_PARALLEL_GENERATIONS, 4);
  assert.deepEqual(ids.map((id) => statuses()[id]), ['running', 'running', 'running', 'running', 'queued']);
  assert.equal(fake.edits.length, 4, 'four AI calls are in flight together');

  fake.edits[0].resolve(aiResult());
  await settle();
  assert.equal(fake.edits.length, 5, 'the fifth started as soon as a place was free');
  assert.deepEqual(ids.map((id) => statuses()[id]), [undefined, 'running', 'running', 'running', 'running']);
  assert.equal(layerOf(ids[0]).variants?.length, 1);
});

test('asking again for a layer that is queued or running does nothing', async (t) => {
  const fake = fakeEverything(t);
  const [id] = openLayers(1);

  startGeneration(input(id));
  await settle();
  startGeneration(input(id, 'another try'));
  await settle();

  assert.equal(fake.edits.length, 1);
  assert.equal(statuses()[id], 'running');
});

test('a failed generation is kept with its reason, does not block the others, and the layer can try again', async (t) => {
  const fake = fakeEverything(t);
  const [first, second] = openLayers(2);

  startGeneration(input(first));
  startGeneration(input(second));
  await settle();
  fake.edits[0].reject(new Error('server busy'));
  await settle();

  assert.equal(useProjectStore.getState().generations[first].status, 'failed');
  assert.equal(useProjectStore.getState().generations[first].error, 'server busy');
  assert.equal(statuses()[second], 'running');
  assert.equal(layerOf(first).variants?.length ?? 0, 0);
  assert.equal(hasGenerationInFlight(useProjectStore.getState().generations), true, 'the other one is still running');

  fake.edits[1].resolve(aiResult());
  await settle();
  assert.equal(hasGenerationInFlight(useProjectStore.getState().generations), false, 'only the failed one is left');

  startGeneration(input(first));
  await settle();
  assert.equal(statuses()[first], 'running');
  assert.equal(useProjectStore.getState().generations[first].error, undefined);
});

test('a layer that is not open gets its result without any change to what the 360 view shows', async (t) => {
  const fake = fakeEverything(t);
  const [layerId, otherId] = openLayers(2);
  useProjectStore.getState().updateLayer(layerId, {
    status: 'committed', equirectImageId: 'equirect-old',
    variants: [{ id: 'old', resultImageId: 'old-result', source: 'ai-generated', applied: true, equirectImageId: 'equirect-old', width: 640, height: 480, createdAt: 1 }],
  });
  useProjectStore.getState().openLayerEditor(otherId); // another layer is the one being edited
  useProjectStore.setState({ reviewVariantId: 'something-else' });

  startGeneration(input(layerId, 'hdr please'));
  await settle();
  fake.edits[0].resolve(aiResult('gpt-test'));
  await settle();

  const layer = layerOf(layerId);
  assert.equal(layer.variants?.length, 2);
  const fresh = layer.variants![1];
  assert.deepEqual([fresh.source, fresh.modelId, fresh.applied, fresh.resultImageId, fresh.width, fresh.height], ['ai-generated', 'gpt-test', false, 'cache-1', 640, 480]);
  assert.deepEqual([layer.variants![0].applied, layer.variants![0].equirectImageId, layer.equirectImageId, layer.status], [true, 'equirect-old', 'equirect-old', 'committed']);
  assert.equal(layer.prompt, 'hdr please');
  assert.equal(layer.selection?.prompt, 'hdr please');
  assert.equal(useProjectStore.getState().reviewVariantId, 'something-else', 'the editor of the other layer is not disturbed');
  assert.equal(useProjectStore.getState().activeLayerId, otherId);
  assert.equal(useProjectStore.getState().workflow, 'canvas-edit');
  assert.deepEqual(useProjectStore.getState().generatedVariants, []);
  assert.equal(statuses()[layerId], undefined);
});

test('the layer that is open moves to the new result for looking, still without applying it', async (t) => {
  const fake = fakeEverything(t);
  const [layerId] = openLayers(1);
  useProjectStore.getState().openLayerEditor(layerId);
  useProjectStore.setState({ regionEdit: { points: [{ x: 1, y: 1 }], maskBase64: 'region-mask' } });

  startGeneration(input(layerId, 'hdr please'));
  await settle();
  useProjectStore.setState({ regionEdit: null });
  fake.edits[0].resolve(aiResult('gpt-test'));
  await settle();

  const state = useProjectStore.getState();
  const fresh = layerOf(layerId).variants![0];
  assert.equal(state.reviewVariantId, fresh.id);
  assert.equal(state.workflow, 'ai-review');
  assert.deepEqual(state.generatedVariants.map((item) => item.base64Result), ['blended-base64']);
  assert.equal(state.selectedVariantId, state.generatedVariants[0].id);
  assert.equal(state.regionEdit, null);
  assert.equal(state.selectionDraft?.prompt, 'hdr please');
  assert.equal(layerOf(layerId).variants?.some((item) => item.applied), false, 'nothing was applied to the 360 view');
  assert.equal(layerOf(layerId).status, 'draft');
});

test('a result that arrives after another image was opened or the layer was deleted is dropped', async (t) => {
  const fake = fakeEverything(t);
  const [kept, deleted] = openLayers(2);
  startGeneration(input(kept));
  startGeneration(input(deleted));
  await settle();

  useProjectStore.getState().removeLayer(deleted);
  fake.edits[1].resolve(aiResult());
  await settle();
  assert.equal(layerOf(kept).variants?.length ?? 0, 0);
  assert.deepEqual(useProjectStore.getState().layers.map((layer) => layer.id), [kept]);

  // Opening the same project again keeps its layer ids: the result of the old session must not leak into the new one.
  const twin = layerOf(kept);
  useProjectStore.getState().openImage('b.jpg', 10000, 5000);
  useProjectStore.setState({ layers: [{ ...twin, variants: [] }] });
  fake.edits[0].resolve(aiResult());
  await settle();
  assert.deepEqual(useProjectStore.getState().layers[0].variants, []);
  assert.deepEqual(useProjectStore.getState().generations, {});
});

test('the chain is the same as before: translate, source of the result being looked at, mask, references, region', async (t) => {
  const fake = fakeEverything(t);
  const [layerId] = openLayers(1);
  useProjectStore.getState().updateLayer(layerId, {
    variants: [{ id: 'seen', resultImageId: 'seen-result', source: 'ai-generated', applied: false, width: 640, height: 480, createdAt: 1 }],
  });
  useProjectStore.getState().openLayerEditor(layerId);
  useProjectStore.getState().setReviewVariant('seen');
  const region = { points: [{ x: 10, y: 10 }, { x: 600, y: 10 }, { x: 600, y: 400 }], maskBase64: 'region-mask' };
  useProjectStore.setState({ regionEdit: region });
  const withReferences = { ...model, supportsReferenceImages: true } as AiModelOption;

  startGeneration({
    layerId, prompt: '  dọn sạch quầng sáng  ', model: withReferences,
    referenceImages: [{ base64Data: 'ref-1', mimeType: 'image/png' }],
  });
  await settle();

  assert.deepEqual(fake.sourceImage.mock.calls[0].arguments[0], {
    imagePath: 'a.jpg', sourceResultId: 'seen-result', tile: { x: 0, y: 0, w: 640, h: 480 },
  });
  assert.deepEqual(fake.whiteMask.mock.callCount(), 0, 'a drawn region replaces the white mask');
  const sent = fake.calls[0];
  assert.equal(sent.provider, 'ninerouter');
  assert.equal(sent.modelId, 'cx/gpt-6-astra');
  assert.equal(sent.base64Image, 'source-base64');
  assert.equal(sent.base64Mask, 'region-mask');
  assert.equal(sent.hasRegionMask, true);
  assert.deepEqual(sent.referenceImages, [{ base64Data: 'ref-1', mimeType: 'image/png' }]);
  assert.match(sent.prompt, /^EN:dọn sạch quầng sáng \(apply this specifically within the region at /);
  assert.match(sent.prompt, /Image\/Figure 1 is the source scene to edit/);

  fake.edits[0].resolve(aiResult());
  await settle();
  assert.deepEqual(fake.blend.mock.calls[0].arguments, ['source-base64', 'edited-base64', 'region-mask']);
});

test('looking at the original makes the layer own tile the source, and an unsupported model gets no references', async (t) => {
  const fake = fakeEverything(t);
  const [layerId] = openLayers(1);
  useProjectStore.getState().openLayerEditor(layerId);
  useProjectStore.getState().setReviewVariant(null);

  startGeneration({ layerId, prompt: 'hdr', model, referenceImages: [{ base64Data: 'ref-1', mimeType: 'image/png' as const }] });
  await settle();

  assert.equal((fake.sourceImage.mock.calls[0].arguments[0] as any).sourceResultId, 'tile-0');
  assert.deepEqual(fake.whiteMask.mock.calls[0].arguments, [640, 480]);
  assert.equal(fake.calls[0].base64Mask, 'white-mask');
  assert.equal(fake.calls[0].hasRegionMask, false);
  assert.deepEqual(fake.calls[0].referenceImages, []);
  assert.equal(fake.calls[0].prompt, 'EN:hdr');
});

test('hasGenerationInFlight is true while anything is queued or running, false for failures only', () => {
  assert.equal(hasGenerationInFlight({}), false);
  assert.equal(hasGenerationInFlight({ a: { status: 'failed', error: 'x', startedAt: 1 } }), false);
  assert.equal(hasGenerationInFlight({ a: { status: 'failed', startedAt: 1 }, b: { status: 'queued', startedAt: 2 } }), true);
  assert.equal(hasGenerationInFlight({ a: { status: 'running', startedAt: 1 } }), true);
});
