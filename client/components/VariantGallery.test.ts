import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import type { Layer, LayerVariant } from '../../shared/types';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

const variant = (id: string, patch: Partial<LayerVariant> = {}): LayerVariant => ({
  id, resultImageId: `result-${id}`, source: 'ai-generated', applied: false, width: 100, height: 80, createdAt: 1, ...patch,
});

async function mountGallery(variants: LayerVariant[], review: string | null, layerPatch: Partial<Layer> = {}) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const VariantGallery = (await importUnsafe('./VariantGallery')).default;
  const layer: Layer = {
    id: 'layer', order: 1, type: 'perspective', visible: true, yaw: 0, pitch: 0, roll: 0, fov: 60,
    tileCoords: { x: 0, y: 0, w: 100, h: 80 }, maskData: [], prompt: '', resultImageId: 'original', status: 'draft',
    variants, ...layerPatch,
  };
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('a.jpg', 10000, 5000);
  useProjectStore.setState({ layers: [layer], activeLayerId: 'layer', workflow: 'canvas-edit', reviewVariantId: review });
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(VariantGallery)));
  const cards = () => Array.from(container.querySelectorAll('.variant-card')) as HTMLElement[];
  const badges = () => cards().map((card) => Array.from(card.querySelectorAll('.variant-badge')).map((badge) => badge.textContent));
  const close = async () => { await act(async () => root.unmount()); dom.window.close(); };
  return { store: useProjectStore, cards, badges, close, dom };
}

const looking = '✓ ĐANG XEM';
const atView = '🌐 Đang ở 360 View';

test('clicking a result only changes what is being looked at: the layers, and so the 360 view, are untouched', async () => {
  const { store, cards, badges, close } = await mountGallery(
    [variant('a', { applied: true, equirectImageId: 'eq-a' }), variant('b')], 'a', { status: 'committed', equirectImageId: 'eq-a' },
  );
  try {
    assert.deepEqual(badges(), [[], [looking, atView], []], 'original, a (looked at and on the 360 view), b');
    const before = store.getState().layers;

    await act(async () => (cards()[2].querySelector('.variant-thumb-wrapper') as HTMLElement).click());

    assert.equal(store.getState().reviewVariantId, 'b');
    assert.equal(store.getState().layers, before);
    assert.deepEqual(badges(), [[], [atView], [looking]], 'the applied one keeps its 360 badge');
  } finally {
    await close();
  }
});

test('clicking the original looks at the original and leaves what is applied alone', async () => {
  const { store, cards, badges, close } = await mountGallery([variant('a', { applied: true, equirectImageId: 'eq-a' })], 'a');
  try {
    const before = store.getState().layers;
    await act(async () => (cards()[0].querySelector('.variant-thumb-wrapper') as HTMLElement).click());

    assert.equal(store.getState().reviewVariantId, null);
    assert.equal(store.getState().layers, before);
    assert.deepEqual(badges(), [[looking], [atView]]);
  } finally {
    await close();
  }
});

test('deleting the result being looked at moves to the newest one that is left, or the original', async () => {
  const { store, cards, dom, close } = await mountGallery([variant('a', { createdAt: 1 }), variant('b', { createdAt: 2 }), variant('c', { createdAt: 3 })], 'c');
  (globalThis as any).confirm = () => true;
  try {
    const remove = (index: number) => (cards()[index].querySelector('.variant-delete') as HTMLElement).click();

    await act(async () => remove(3)); // c, the one being looked at
    assert.deepEqual(store.getState().layers[0].variants?.map((item: LayerVariant) => item.id), ['a', 'b']);
    assert.equal(store.getState().reviewVariantId, 'b');

    await act(async () => remove(1)); // a, not the one being looked at
    assert.equal(store.getState().reviewVariantId, 'b');

    await act(async () => remove(1)); // b
    assert.equal(store.getState().reviewVariantId, null);
  } finally {
    delete (globalThis as any).confirm;
    await close();
    void dom;
  }
});
