import { test } from 'node:test';
import assert from 'node:assert';
import { createElement } from 'react';
import { setupDom } from '../test-utils/dom';
import { installFakeImage, stubCanvas2d } from '../test-utils/canvas-stub';

function importUnsafe(specifier: string): Promise<any> {
  return import(specifier);
}

function setup(dom: any, resolve: (src: string) => { width: number; height: number; delayMs?: number }) {
  setupDom(dom);
  stubCanvas2d(dom);
  (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  installFakeImage(globalThis, resolve);
}

const LAYER = {
  id: 'layer', order: 1, type: 'flat', visible: true,
  yaw: 0, pitch: 0, roll: 0, fov: 90,
  tileCoords: { x: 0, y: 0, w: 100, h: 50 },
  maskData: [], prompt: '', resultImageId: 'original', status: 'committed',
};

const NEEDS_FIT_VARIANT = {
  id: 'variant', resultImageId: 'full-size', source: 'imported', applied: false,
  width: 200, height: 50, needsFit: true, createdAt: 1,
};

// Regression: opening the editor on a needsFit variant used to hit
// `displayRef.current!.width` while the mask canvas was not mounted yet
// (transform mode), throwing an uncaught TypeError and leaving the mask
// editor without a working brush after the crop was applied.
test('mask editor is ready for brushing after committing a transform', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setup(dom, () => ({ width: 200, height: 50 }));

  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const ResultMaskEditor = (await importUnsafe('./ResultMaskEditor')).default;

  useProjectStore.setState({ layers: [{ ...LAYER, variants: [NEEDS_FIT_VARIANT] }] } as any);

  const caught: string[] = [];
  const swallow = (error: Error) => { caught.push(error.message); };
  process.on('uncaughtException', swallow);

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(createElement(ResultMaskEditor, { layerId: 'layer', variant: NEEDS_FIT_VARIANT, onClose() {} }));
    });
    assert.ok(container.innerHTML.includes('variant-transform'), 'mở ở chế độ căn chỉnh');

    const updated = { ...NEEDS_FIT_VARIANT, resultImageId: 'cropped', width: 100, height: 50, needsFit: false };
    await React.act(async () => {
      useProjectStore.getState().updateVariantResult('layer', NEEDS_FIT_VARIANT.id, {
        resultImageId: 'cropped', width: 100, height: 50,
      });
      root.render(createElement(ResultMaskEditor, { layerId: 'layer', variant: updated, onClose() {} }));
    });
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    assert.equal(container.innerHTML.includes('Đang tải ảnh'), false, 'ảnh kết quả phải load xong');
    assert.equal(caught.length, 0, `không được có lỗi uncaught: ${caught.join(' | ')}`);
  } finally {
    process.off('uncaughtException', swallow);
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});

// Switching to the Mask tab (or pressing Bỏ qua) without committing used to
// leave `ready` stuck at false — the mask loader had already crashed while the
// canvas was unmounted and nothing re-ran it, so the brush stayed dead.
test('mask tab is usable even when the editor opened in transform mode first', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setup(dom, () => ({ width: 200, height: 50 }));

  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const ResultMaskEditor = (await importUnsafe('./ResultMaskEditor')).default;

  useProjectStore.setState({ layers: [{ ...LAYER, variants: [NEEDS_FIT_VARIANT] }] } as any);

  const caught: string[] = [];
  const swallow = (error: Error) => { caught.push(error.message); };
  process.on('uncaughtException', swallow);

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(createElement(ResultMaskEditor, { layerId: 'layer', variant: NEEDS_FIT_VARIANT, onClose() {} }));
    });
    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const maskTab = buttons.find((button) => button.textContent?.includes('Mask'));
    assert.ok(maskTab, 'có nút chuyển sang chế độ Mask');
    await React.act(async () => { (maskTab as HTMLButtonElement).click(); });
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    assert.equal(container.innerHTML.includes('Đang tải ảnh'), false, 'brush phải dùng được ở tab Mask');
    assert.equal(caught.length, 0, `không được có lỗi uncaught: ${caught.join(' | ')}`);
  } finally {
    process.off('uncaughtException', swallow);
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});

// A late-arriving load of the previous (uncropped) image must not clobber the
// freshly committed crop — that race made the editor show the wrong image and
// a mask that no longer matched what the user was painting.
test('a stale image load cannot overwrite the committed crop', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setup(dom, (src) => (src.includes('full-size')
    ? { width: 800, height: 400, delayMs: 150 }
    : { width: 100, height: 25 }));

  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const ResultMaskEditor = (await importUnsafe('./ResultMaskEditor')).default;

  useProjectStore.setState({ layers: [{ ...LAYER, variants: [NEEDS_FIT_VARIANT] }] } as any);

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(createElement(ResultMaskEditor, { layerId: 'layer', variant: NEEDS_FIT_VARIANT, onClose() {} }));
    });

    // Commit before the slow 800×400 load finishes
    const updated = { ...NEEDS_FIT_VARIANT, resultImageId: 'cropped', width: 100, height: 25, needsFit: false };
    await React.act(async () => {
      useProjectStore.getState().updateVariantResult('layer', NEEDS_FIT_VARIANT.id, {
        resultImageId: 'cropped', width: 100, height: 25,
      });
      root.render(createElement(ResultMaskEditor, { layerId: 'layer', variant: updated, onClose() {} }));
    });
    // Let the stale 150ms load fire
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });

    const canvas = container.querySelector('canvas');
    assert.equal(canvas?.width, 100, 'canvas phải giữ kích thước ảnh đã cắt');
    assert.equal(canvas?.height, 25);
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});
