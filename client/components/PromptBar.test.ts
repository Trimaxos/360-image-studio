import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

test('model can be chosen before cropping but is locked during generation', async (t) => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const { api } = await importUnsafe('../lib/api');
  const PromptBar = (await importUnsafe('./PromptBar')).default;
  const model = { id: 'gpt-test', provider: 'fal', displayName: 'GPT', enabled: true, supportsCustomImageSize: true };
  t.mock.method(api.ai, 'models', async () => ({ groups: [{ provider: 'fal', label: 'fal', models: [model] }] }));
  useProjectStore.getState().reset();
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(PromptBar)));
    for (const workflow of ['viewing', 'rect-select', 'canvas-edit', 'generating']) {
      await act(async () => useProjectStore.setState({ workflow }));
      const select = container.querySelector('select[aria-label=Model]') as HTMLSelectElement;
      assert.equal(select.disabled, workflow === 'generating', workflow);
    }
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

// --- Generate now hands the work to a generation that belongs to the layer (client/lib/generation.ts) ---

const aiModel = { id: 'cx/gpt-test', provider: 'ninerouter', displayName: 'GPT', enabled: true, capabilities: ['image-edit'] };
const draftSelection = (prompt: string) => ({
  sourceView: '360', mode: 'free-select', rect: { x: 0, y: 0, width: 100, height: 100 },
  viewport: { width: 1120, height: 761 }, tileCoords: { x: 0, y: 0, w: 640, h: 480 },
  viewPose: { yaw: 0, pitch: 0, roll: 0, fov: 60 }, prompt,
});

async function mountOpenLayer(t: any, prompt = 'hdr please') {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const { api } = await importUnsafe('../lib/api');
  const { generationSteps } = await importUnsafe('../lib/generation');
  const PromptBar = (await importUnsafe('./PromptBar')).default;
  t.mock.method(api.ai, 'models', async () => ({ groups: [{ provider: 'ninerouter', label: '9router', models: [aiModel] }] }));
  t.mock.method(api.ai, 'translate', async (text: string) => ({ translated: `EN:${text}`, detectedLanguage: 'vi' }));
  const edits: Array<(value: unknown) => void> = [];
  t.mock.method(api.ai, 'edit', () => new Promise((resolve) => { edits.push(resolve); }));
  t.mock.method(api.image, 'saveResultCache', async () => ({ resultImageId: 'cache-1', sizeBytes: 1 }));
  t.mock.method(generationSteps, 'sourceImage', async () => 'source-base64');
  t.mock.method(generationSteps, 'whiteMask', async () => 'white-mask');

  const store = useProjectStore.getState();
  store.reset();
  store.openImage('a.jpg', 10000, 5000);
  store.addDraftLayer(draftSelection(prompt), 'tile-1', 640, 480, 'Layer 1');
  store.addDraftLayer(draftSelection('other'), 'tile-2', 640, 480, 'Layer 2');
  const [first, second] = useProjectStore.getState().layers.map((layer: any) => layer.id);
  store.openLayerEditor(first);
  store.setSelectedModel(aiModel);

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(PromptBar)));
  const generate = () => container.querySelector('button.prompt-btn-generate') as HTMLButtonElement;
  const input = () => container.querySelector('input[placeholder="Nhập prompt..."]') as HTMLInputElement;
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  const close = async () => { await act(async () => root.unmount()); dom.window.close(); };
  return { store: useProjectStore, container, generate, input, first, second, edits, settle, close };
}

test('Generate starts a generation of the open layer without putting the whole app in a generating state', async (t) => {
  const { store, generate, input, first, edits, settle, close } = await mountOpenLayer(t);
  try {
    assert.equal(generate().disabled, false);
    await act(async () => generate().click());
    await settle();

    assert.equal(store.getState().generations[first].status, 'running');
    assert.equal(edits.length, 1, 'the AI call is out');
    assert.equal(store.getState().workflow, 'canvas-edit', 'the app is not locked');
    assert.equal(generate().textContent, 'Generating…');
    assert.equal(generate().disabled, true);
    assert.equal(input().disabled, true);
  } finally {
    await close();
  }
});

test('a generation waiting for a free place says so', async (t) => {
  const { store, generate, first, close } = await mountOpenLayer(t);
  try {
    await act(async () => store.getState().setGeneration(first, { status: 'queued', startedAt: 1 }));
    assert.equal(generate().textContent, 'Đang chờ lượt…');
    assert.equal(generate().disabled, true);
  } finally {
    await close();
  }
});

test('another layer generating does not stop this one from generating', async (t) => {
  const { store, generate, input, second, close } = await mountOpenLayer(t);
  try {
    await act(async () => store.getState().setGeneration(second, { status: 'running', startedAt: 1 }));
    assert.equal(generate().disabled, false);
    assert.equal(generate().textContent, 'Generate');
    assert.equal(input().disabled, false);
  } finally {
    await close();
  }
});

test('a failed generation shows its reason and the layer can be generated again', async (t) => {
  const { store, container, generate, first, close } = await mountOpenLayer(t);
  try {
    await act(async () => store.getState().setGeneration(first, { status: 'failed', error: 'server busy', startedAt: 1 }));
    assert.match(container.querySelector('.prompt-error')!.textContent!, /server busy/);
    assert.equal(generate().disabled, false);
  } finally {
    await close();
  }
});
