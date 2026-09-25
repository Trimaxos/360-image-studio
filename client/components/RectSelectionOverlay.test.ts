import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, act } from 'react';
import { setupDom } from '../test-utils/dom';
import { SELECTION_RATIOS, dragRect } from './rect-selection';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

for (const ratio of SELECTION_RATIOS) {
  test(`fixed ${ratio}: all directions stay within bounds without grid snapping`, () => {
    const [w, h] = ratio.split(':').map(Number);
    const bounds = { x: 30, y: 50, width: 1000, height: 700 };
    for (const x of [-100, 347, 1500]) for (const y of [-100, 263, 1000]) {
      const rect = dragRect({ x: 400, y: 350 }, { x, y }, bounds, w / h);
      assert.ok(Math.abs(rect.width / rect.height - w / h) < 1e-10);
      assert.ok(rect.x >= bounds.x && rect.y >= bounds.y);
      assert.ok(rect.x + rect.width <= 1030 + 1e-9);
      assert.ok(rect.y + rect.height <= 750 + 1e-9);
    }
    const rect = dragRect({ x: 100, y: 100 }, { x: 201, y: 201 }, bounds, w / h);
    assert.ok(rect.width % 16 !== 0 || rect.height % 16 !== 0);
  });
}

for (const sourceView of ['flat', '360'] as const) {
  for (const fullFrame of [false, true]) {
    test(`${sourceView}: ${fullFrame ? 'Full Frame' : 'preset drag'} applies without model alignment`, async (t) => {
      const { JSDOM } = await importUnsafe('jsdom');
      const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
      setupDom(dom);
      (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
      dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
        x: 0, y: 0, left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700,
      });
      dom.window.HTMLElement.prototype.setPointerCapture = () => {};
      dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
      const { createRoot } = await importUnsafe('react-dom/client');
      const { useProjectStore } = await importUnsafe('../stores/project');
      const { api } = await importUnsafe('../lib/api');
      const Overlay = (await importUnsafe('./RectSelectionOverlay')).default;
      useProjectStore.getState().reset();
      useProjectStore.setState({ imagePath: 'test.png', imageWidth: 1000, imageHeight: 700,
        workflow: 'rect-select', selectedModel: { id: 'gpt-test', supportsCustomImageSize: true } });
      const expected = fullFrame ? { x: 0, y: 0, width: 1000, height: 700 }
        : { x: 100, y: 100, width: 402, height: 268 };
      let calls = 0;
      t.mock.method(api.image, 'perspectiveRender', async (body: any) => {
        calls++;
        assert.equal(body.alignToModel, false);
        assert.deepEqual(body.rect, expected);
        return { resultImageId: 'rendered', width: expected.width, height: expected.height, rect: expected };
      });
      const container = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(container);
      const root = createRoot(container);
      try {
        await act(async () => root.render(createElement(Overlay, { sourceView })));
        const button = (text: string) => Array.from(container.querySelectorAll('button'))
          .find((b: any) => b.textContent === text) as HTMLButtonElement;
        const select = container.querySelector('select') as HTMLSelectElement;
        assert.deepEqual(Array.from(select.options).map(o => o.value), [...SELECTION_RATIOS]);
        assert.equal(select.value, '1:1');
        assert.equal(container.querySelector('input[type=checkbox]'), null);
        await act(async () => { button('Full Frame').click(); });
        if (!fullFrame) {
          await act(async () => {
            select.value = '3:2';
            select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
          });
          assert.equal(container.querySelector('.selection-rect'), null);
          assert.equal(button('Apply Rect').disabled, true);
          const overlay = container.querySelector('.rect-select-overlay')!;
          for (const [type, x, y] of [['pointerdown', 100, 100], ['pointermove', 502, 301], ['pointerup', 502, 301]] as const) {
            await act(async () => {
              overlay.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
            });
            if (type === 'pointermove') {
              const preview = container.querySelector('.selection-rect') as HTMLElement;
              assert.equal(preview.style.width, '402px');
              assert.equal(preview.style.height, '268px');
            }
          }
        }
        assert.equal(useProjectStore.getState().layers.length, 0);
        await act(async () => { button('Apply Rect').click(); });
        const layer = useProjectStore.getState().layers[0];
        assert.deepEqual(layer.selection.rect, expected);
        assert.deepEqual(layer.tileCoords, { x: sourceView === 'flat' ? expected.x : 0,
          y: sourceView === 'flat' ? expected.y : 0, w: expected.width, h: expected.height });
        assert.equal(calls, sourceView === '360' ? 1 : 0);
      } finally {
        await act(async () => root.unmount());
        dom.window.close();
      }
    });
  }
}
