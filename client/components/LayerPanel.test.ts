import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import type { Layer } from '../../shared/types';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

const layer = (id: string, order: number, patch: Partial<Layer> = {}): Layer => ({
  id, order, type: 'perspective', visible: true, yaw: 0, pitch: 0, roll: 0, fov: 60,
  tileCoords: { x: 0, y: 0, w: 640, h: 480 }, maskData: [], prompt: '', resultImageId: 'tile', status: 'draft', name: `Layer ${order}`, variants: [], ...patch,
});
const results = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `v${index}`, resultImageId: `r${index}`, source: 'ai-generated' as const, applied: false, width: 640, height: 480, createdAt: index,
}));

async function mountPanel(layers: Layer[]) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const LayerPanel = (await importUnsafe('./LayerPanel')).default;
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('a.jpg', 10000, 5000);
  useProjectStore.setState({ layers });
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(LayerPanel)));
  const row = (name: string) => Array.from(container.querySelectorAll('.layer-item')).find((item: any) => item.textContent.includes(name)) as HTMLElement;
  const close = async () => { await act(async () => root.unmount()); dom.window.close(); };
  return { store: useProjectStore, container, row, close };
}

test('every layer shows whether its generation is waiting, running or failed, and how many results it has', async () => {
  const { store, row, close } = await mountPanel([
    layer('a', 1, { variants: results(2) }),
    layer('b', 2),
    layer('c', 3),
    layer('d', 4),
  ]);
  try {
    await act(async () => {
      store.getState().setGeneration('a', { status: 'running', startedAt: 1 });
      store.getState().setGeneration('b', { status: 'queued', startedAt: 2 });
      store.getState().setGeneration('c', { status: 'failed', error: 'server busy', startedAt: 3 });
    });

    assert.match(row('Layer 1').querySelector('.layer-meta')!.textContent!, /2 kết quả/);
    assert.match(row('Layer 1').querySelector('.layer-meta')!.textContent!, /⏳ đang gen/);
    assert.match(row('Layer 2').querySelector('.layer-meta')!.textContent!, /⏳ đang chờ lượt/);
    assert.match(row('Layer 3').querySelector('.layer-meta')!.textContent!, /⚠ lỗi/);
    assert.equal(row('Layer 3').querySelector('.layer-job')!.getAttribute('title'), 'server busy');
    assert.doesNotMatch(row('Layer 4').querySelector('.layer-meta')!.textContent!, /kết quả|⏳|⚠/);
  } finally {
    await close();
  }
});

test('a layer can be opened for editing from the viewing screen while another layer is generating', async () => {
  const { store, row, close } = await mountPanel([layer('a', 1), layer('b', 2)]);
  try {
    await act(async () => store.getState().setGeneration('a', { status: 'running', startedAt: 1 }));
    const edit = row('Layer 2').querySelector('button[title="Edit"]') as HTMLButtonElement;
    assert.equal(edit.disabled, false);

    await act(async () => edit.click());

    assert.equal(store.getState().workflow, 'canvas-edit');
    assert.equal(store.getState().activeLayerId, 'b');
    assert.equal(store.getState().generations.a.status, 'running', 'the other generation is not touched');
  } finally {
    await close();
  }
});
