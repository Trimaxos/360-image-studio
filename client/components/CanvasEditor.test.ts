import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import type { Layer, LayerVariant } from '../../shared/types';
import { installFakeImage, stubCanvas2d } from '../test-utils/canvas-stub';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

const variant = (id: string, patch: Partial<LayerVariant> = {}): LayerVariant => ({
  id, resultImageId: `result-${id}`, source: 'ai-generated', applied: false, width: 100, height: 80, createdAt: 1, ...patch,
});

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

/** The editor open on a 360 layer with the given results, looking at `review`. */
async function mountEditor(t: any, variants: LayerVariant[], review: string | null, layerPatch: Partial<Layer> = {}, prepare?: () => void) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  stubCanvas2d(dom); // the picture on the canvas is not what these tests are about
  (globalThis as any).fetch = async () => { throw new Error('no network in this test'); };
  // fabric caches the first window it sees; point it at this test's window so its render frames do not outlive it
  const fabric = await importUnsafe('fabric');
  fabric.setEnv({ ...fabric.getEnv(), window: dom.window, document: dom.window.document });
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const { api } = await importUnsafe('../lib/api');
  const CanvasEditor = (await importUnsafe('./CanvasEditor')).default;
  const reproject = deferred<{ equirectImageId: string }>();
  const reprojectMock = t.mock.method(api.image, 'reproject', () => reproject.promise);

  const store = useProjectStore.getState();
  store.reset();
  store.openImage('a.jpg', 10000, 5000);
  store.addDraftLayer({
    sourceView: '360', mode: 'free-select', rect: { x: 0, y: 0, width: 100, height: 100 }, viewport: { width: 1120, height: 761 },
    tileCoords: { x: 0, y: 0, w: 100, h: 80 }, viewPose: { yaw: 0, pitch: 0, roll: 0, fov: 60 }, prompt: 'p',
  }, 'original', 100, 80, 'Layer');
  const layerId = useProjectStore.getState().layers[0].id;
  useProjectStore.getState().updateLayer(layerId, { variants, ...layerPatch });
  useProjectStore.getState().openLayerEditor(layerId);
  useProjectStore.setState({ reviewVariantId: review });

  prepare?.();
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(CanvasEditor)));
  const applyButton = () => container.querySelector('button.canvas-apply-btn') as HTMLButtonElement;
  const backButton = () => Array.from(container.querySelectorAll('button')).find((button: any) => /Back to View/.test(button.textContent)) as HTMLButtonElement;
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  // fabric's canvas may have a render frame pending; let it fire before the window it belongs to is closed
  const close = async () => { await act(async () => root.unmount()); await new Promise((resolve) => setTimeout(resolve, 50)); dom.window.close(); };
  return { store: useProjectStore, container, layerId, reproject, reprojectMock, applyButton, backButton, settle, close };
}

test('Áp dụng ra 360 applies the result being looked at, locks Back meanwhile, and says when it is done', async (t) => {
  const { store, container, layerId, reproject, reprojectMock, applyButton, backButton, settle, close } = await mountEditor(
    t, [variant('a'), variant('b')], 'b',
  );
  try {
    assert.equal(applyButton().textContent, '✓ Áp dụng ra 360');
    assert.equal(applyButton().disabled, false);

    await act(async () => applyButton().click());
    await settle();

    assert.equal(reprojectMock.mock.callCount(), 1);
    assert.equal((reprojectMock.mock.calls[0].arguments[0] as any).resultImageId, 'result-b');
    assert.equal(applyButton().textContent, 'Đang áp…');
    assert.equal(applyButton().disabled, true);
    assert.equal(backButton().disabled, true, 'leaving while the picture is being applied would lose the reply');

    reproject.resolve({ equirectImageId: 'equirect-b' });
    await settle();

    const layer = store.getState().layers.find((item: Layer) => item.id === layerId)!;
    assert.deepEqual(layer.variants?.map((item: LayerVariant) => [item.id, item.applied]), [['a', false], ['b', true]]);
    assert.equal(layer.status, 'committed');
    assert.equal(applyButton().textContent, '✓ Áp dụng ra 360');
    assert.equal(backButton().disabled, false);
    assert.match(container.querySelector('.canvas-exchange-message')!.textContent!, /Đã áp dụng ra 360 View/);
  } finally {
    await close();
  }
});

test('applying while looking at the original takes the layer out of the 360 view', async (t) => {
  const { store, layerId, reprojectMock, applyButton, settle, close } = await mountEditor(
    t, [variant('a', { applied: true, equirectImageId: 'equirect-a' })], null, { status: 'committed', equirectImageId: 'equirect-a' },
  );
  try {
    await act(async () => applyButton().click());
    await settle();

    const layer = store.getState().layers.find((item: Layer) => item.id === layerId)!;
    assert.deepEqual(layer.variants?.map((item: LayerVariant) => [item.applied, item.equirectImageId]), [[false, undefined]]);
    assert.equal(layer.equirectImageId, undefined);
    assert.equal(reprojectMock.mock.callCount(), 0);
  } finally {
    await close();
  }
});

test('a result that still needs fitting cannot be applied', async (t) => {
  const { applyButton, close } = await mountEditor(t, [variant('a', { needsFit: true })], 'a');
  try {
    assert.equal(applyButton().disabled, true);
  } finally {
    await close();
  }
});

test('a failed application says why and leaves the layer as it was', async (t) => {
  const { store, container, layerId, reproject, applyButton, settle, close } = await mountEditor(t, [variant('a')], 'a');
  try {
    await act(async () => applyButton().click());
    await settle();
    reproject.reject(new Error('server busy'));
    await settle();

    assert.match(container.querySelector('.canvas-exchange-message')!.textContent!, /server busy/);
    const layer = store.getState().layers.find((item: Layer) => item.id === layerId)!;
    assert.equal(layer.status, 'draft');
    assert.deepEqual(layer.variants?.map((item: LayerVariant) => item.applied), [false]);
    assert.equal(applyButton().disabled, false);
  } finally {
    await close();
  }
});

test('Back only hides the editor: no question, nothing applied, the generation on this layer keeps running', async (t) => {
  const { store, container, layerId, reprojectMock, backButton, close } = await mountEditor(t, [variant('a'), variant('b')], 'b');
  try {
    await act(async () => {
      store.getState().setGeneration(layerId, { status: 'running', startedAt: 1 });
      // what happened since the editor was opened: a new result arrived and the prompt was changed
      store.getState().addVariantToLayer(layerId, variant('c'));
      store.getState().setSelectionDraft({ ...store.getState().selectionDraft, prompt: 'edited prompt' });
    });
    assert.equal(store.getState().dirty, true);

    await act(async () => backButton().click());

    assert.equal(!!container.querySelector('.modal-overlay'), false, 'no "save the changes?" question'); // a boolean: a failing assert would print the whole DOM node
    assert.equal(store.getState().workflow, 'viewing');
    assert.equal(store.getState().activeLayerId, null);
    assert.equal(store.getState().generations[layerId].status, 'running');
    assert.equal(reprojectMock.mock.callCount(), 0);
    const layer = store.getState().layers.find((item: Layer) => item.id === layerId)!;
    assert.equal(layer.status, 'draft');
    assert.deepEqual(layer.variants?.map((item: LayerVariant) => [item.id, item.applied]), [['a', false], ['b', false], ['c', false]], 'the new result is not lost');
    assert.equal(layer.prompt, 'edited prompt');
  } finally {
    await close();
  }
});

test('Tiles stitches the dropped tiles into a new imported result without touching the existing ones', async (t) => {
  const { FabricImage } = await importUnsafe('fabric');
  // the picture on the canvas is not under test, only that it counts as loaded
  t.mock.method(FabricImage, 'fromURL', async () => new FabricImage(document.createElement('img'), { width: 100, height: 80 }));
  const { store, container, layerId, settle, close } = await mountEditor(t, [variant('a')], 'a');
  const { api } = await importUnsafe('../lib/api');
  const saveMock = t.mock.method(api.image, 'saveResultCache', async () => ({ resultImageId: 'stitched' }));
  const g = globalThis as any;
  const previous = { fetch: g.fetch, createImageBitmap: g.createImageBitmap, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  g.fetch = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) });
  g.createImageBitmap = async () => ({ width: 10, height: 10, close() {} });
  URL.createObjectURL = () => 'blob:tile';
  URL.revokeObjectURL = () => {};
  try {
    await settle();
    const buttonByText = (pattern: RegExp) => Array.from(container.querySelectorAll('button')).find((button: any) => pattern.test(button.textContent)) as HTMLButtonElement;
    await act(async () => buttonByText(/Tiles/).click());
    const win = container.ownerDocument.defaultView!;
    const event = new win.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [new win.File(['x'], 'tile.png', { type: 'image/png' })] } });
    await act(async () => { container.querySelector('.grid-tiles-cell')!.dispatchEvent(event); });
    await act(async () => buttonByText(/Xác nhận/).click());
    await settle();

    assert.equal(saveMock.mock.callCount(), 1);
    assert.equal(container.querySelector('.grid-tiles-dialog'), null, 'the dialog closes once the new result exists');
    const layer = store.getState().layers.find((item: Layer) => item.id === layerId)!;
    assert.equal(layer.variants!.length, 2);
    assert.deepEqual(layer.variants![0], variant('a'));
    const added = layer.variants![1];
    assert.deepEqual([added.source, added.resultImageId, added.applied, added.width, added.height], ['imported', 'stitched', false, 100, 80]);
    assert.equal(store.getState().reviewVariantId, added.id);
    assert.match(container.querySelector('.canvas-exchange-message')!.textContent!, /Đã ghép 1\/6 tile/);
  } finally {
    Object.assign(g, { fetch: previous.fetch, createImageBitmap: previous.createImageBitmap });
    URL.createObjectURL = previous.createObjectURL;
    URL.revokeObjectURL = previous.revokeObjectURL;
    await close();
  }
});

test('Tiles works on the refined picture the canvas shows when the result has a visibility mask', async (t) => {
  const { FabricImage } = await importUnsafe('fabric');
  t.mock.method(FabricImage, 'fromURL', async () => new FabricImage(document.createElement('img'), { width: 100, height: 80 }));
  const g = globalThis as any;
  const previous = { fetch: g.fetch, image: g.Image };
  const { container, settle, close } = await mountEditor(
    t, [variant('a', { visibilityMask: { base64Mask: 'bWFzaw==', brushSize: 10, brushSoftness: 0 } })], 'a', {},
    () => installFakeImage(g, () => ({ width: 100, height: 80 })),
  );
  const fetched: string[] = [];
  g.fetch = async (url: string) => { fetched.push(url); return { ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) }; };
  try {
    await settle();
    const buttonByText = (pattern: RegExp) => Array.from(container.querySelectorAll('button')).find((button: any) => pattern.test(button.textContent)) as HTMLButtonElement;
    await act(async () => buttonByText(/Tiles/).click());
    await settle();

    // the composed preview (stubbed toDataURL), not the raw result in the cache
    assert.equal(container.querySelector('.grid-tiles-board > img')!.getAttribute('src'), 'data:image/png;base64,c3R1Yg==');
    await act(async () => buttonByText(/Copy ảnh/).click());
    assert.deepEqual(fetched, ['data:image/png;base64,c3R1Yg==']);
  } finally {
    Object.assign(g, { fetch: previous.fetch, Image: previous.image });
    await close();
  }
});
