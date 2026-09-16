import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, act } from 'react';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

for (const sourceView of ['flat', '360'] as const) {
  test(`${sourceView}: Full Frame previews aligned crop; Apply stores the same placement`, async (t) => {
    const { JSDOM } = await importUnsafe('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    setupDom(dom);
    (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, width: 1000, height: 700, right: 1000, bottom: 700,
    });
    const { createRoot } = await importUnsafe('react-dom/client');
    const { useProjectStore } = await importUnsafe('../stores/project');
    const { api } = await importUnsafe('../lib/api');
    const Overlay = (await importUnsafe('./RectSelectionOverlay')).default;
    const { planAlignedSelection } = await importUnsafe('./rect-selection');
    const pose = { yaw: 0, pitch: 0, roll: 0, fov: 90 };
    useProjectStore.getState().reset();
    useProjectStore.setState({ imagePath: 'test.png', imageWidth: 1000, imageHeight: 700,
      viewPose: pose, viewLock: pose, workflow: 'rect-select',
      selectedModel: { id: 'gpt-test', supportsCustomImageSize: true } });
    const expected = planAlignedSelection(sourceView, { x: 0, y: 0, width: 1000, height: 700 },
      { width: 1000, height: 700 }, { width: 1000, height: 700 }, pose);
    let calls = 0;
    t.mock.method(api.image, 'perspectiveRender', async (body: any) => {
      calls++;
      assert.equal(body.alignToModel, true);
      assert.deepEqual(body.rect, { x: 0, y: 0, width: 1000, height: 700 });
      return { resultImageId: 'rendered', ...expected.output, rect: expected.rect };
    });
    const container = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(createElement(Overlay, { sourceView })); });
      const button = (text: string) => Array.from(container.querySelectorAll('button'))
        .find((b: any) => b.textContent === text) as HTMLButtonElement;
      await act(async () => { button('Full Frame').click(); });
      assert.equal(useProjectStore.getState().layers.length, 0, 'must preview before creating a layer');
      const preview = container.querySelector('.selection-rect-aligned') as HTMLElement;
      assert.ok(preview);
      assert.equal(parseFloat(preview.style.left), expected.rect.x);
      assert.equal(parseFloat(preview.style.width), expected.rect.width);
      assert.ok(container.textContent.includes(`${expected.output.width} × ${expected.output.height}`));
      await act(async () => { button('Apply Rect').click(); });
      const layer = useProjectStore.getState().layers[0];
      assert.deepEqual(layer.selection.rect, expected.rect);
      assert.deepEqual(layer.tileCoords, expected.tileCoords);
      assert.equal(calls, sourceView === '360' ? 1 : 0);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
    }
  });
}

test('free drag previews native crop; disabling alignment preserves the user rectangle', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, width: 1200, height: 900, right: 1200, bottom: 900,
  });
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const Overlay = (await importUnsafe('./RectSelectionOverlay')).default;
  useProjectStore.getState().reset();
  useProjectStore.setState({ imagePath: 'test.png', imageWidth: 1200, imageHeight: 900,
    workflow: 'rect-select', selectedModel: { id: 'gpt-test', supportsCustomImageSize: true } });
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Overlay, { sourceView: 'flat' })));
    const overlay = container.querySelector('.rect-select-overlay');
    await act(async () => {
      overlay.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, button: 0 }));
    });
    await act(async () => {
      overlay.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 1076, clientY: 644, button: 0 }));
    });
    // Update while dragging, not only after pointerup. Native crop need not
    // be a multiple of 16; it must match the displayed AI canvas ratio.
    const livePreview = container.querySelector('.selection-rect-aligned') as HTMLElement;
    assert.equal(livePreview.style.left, '112px');
    assert.equal(livePreview.style.top, '106px');
    assert.equal(livePreview.style.width, '952px');
    assert.equal(livePreview.style.height, '532px');
    assert.ok(container.textContent.includes('1088 × 608'));
    await act(async () => {
      overlay.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 1100, clientY: 800, button: 0 }));
    });
    const preview = container.querySelector('.selection-rect-aligned') as HTMLElement;
    assert.equal(preview.style.left, '104px');
    assert.equal(preview.style.top, '106px');
    assert.equal(preview.style.width, '992px');
    await act(async () => { (container.querySelector('input[type=checkbox]') as HTMLInputElement).click(); });
    assert.equal(container.querySelector('.selection-rect-aligned'), null);
    await act(async () => {
      (Array.from(container.querySelectorAll('button')).find((b: any) => b.textContent === 'Apply Rect') as HTMLButtonElement).click();
    });
    assert.deepEqual(useProjectStore.getState().layers[0].tileCoords, { x: 100, y: 100, w: 1000, h: 700 });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
