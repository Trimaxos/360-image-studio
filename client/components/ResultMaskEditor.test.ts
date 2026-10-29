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

// The brush shows two rings like image editors: the outer one is the brush size, the inner one the solid core
// (size × hardness). Both follow the sliders and the [ ] / Shift+[ ] shortcuts.
test('the brush cursor shows an outer and an inner ring that follow size and hardness', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setup(dom, () => ({ width: 200, height: 100 }));
  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const ResultMaskEditor = (await importUnsafe('./ResultMaskEditor')).default;
  const variant = {
    id: 'v', resultImageId: 'r', source: 'imported', applied: true, width: 200, height: 100, createdAt: 1,
    visibilityMask: { base64Mask: '', brushSize: 80, brushOpacity: 100, brushHardness: 50, brushSoftness: 50 },
  };
  useProjectStore.setState({ layers: [{ ...LAYER, variants: [variant] }] } as any);
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => { root.render(createElement(ResultMaskEditor, { layerId: 'layer', variant, onClose() {} })); });
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    const canvas = container.querySelector('.result-mask-workspace canvas') as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const Pointer = dom.window.PointerEvent ?? dom.window.MouseEvent;
    await React.act(async () => {
      canvas.dispatchEvent(new Pointer('pointermove', { bubbles: true, clientX: 50, clientY: 40 }));
    });
    const outer = container.querySelector('.result-mask-cursor:not(.inner)') as HTMLElement;
    const inner = container.querySelector('.result-mask-cursor.inner') as HTMLElement;
    assert.ok(outer && inner, 'two rings');
    assert.equal(outer.style.width, '80px');
    assert.equal(inner.style.width, '40px');
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ']', code: 'BracketRight', bubbles: true }));
      dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '{', code: 'BracketLeft', shiftKey: true, bubbles: true }));
    });
    assert.ok(container.textContent?.includes('88px'), 'size grew by 10%');
    assert.ok(container.textContent?.includes('40%'), 'hardness dropped by 10');
    const rings = container.querySelectorAll('.result-mask-cursor');
    assert.equal((rings[0] as HTMLElement).style.width, '88px');
    assert.equal((rings[1] as HTMLElement).style.width, `${88 * 0.4}px`);
    // A real stroke (down, move, up) goes through the stroke buffer and leaves one undo step behind.
    const undo = container.querySelector('button[title="Undo (Ctrl+Z)"]') as HTMLButtonElement;
    assert.equal(undo.disabled, true, 'nothing to undo yet');
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => { errors.push(event.message); event.preventDefault(); };
    dom.window.addEventListener('error', onError);
    await React.act(async () => {
      canvas.dispatchEvent(new Pointer('pointerdown', { bubbles: true, button: 0, clientX: 50, clientY: 40 }));
      canvas.dispatchEvent(new Pointer('pointermove', { bubbles: true, button: 0, clientX: 90, clientY: 45 }));
      canvas.dispatchEvent(new Pointer('pointerup', { bubbles: true, button: 0, clientX: 90, clientY: 45 }));
    });
    dom.window.removeEventListener('error', onError);
    assert.deepEqual(errors, [], 'painting raised no error');
    assert.equal(undo.disabled, false, 'the stroke pushed an undo snapshot');
  } finally {
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

// "✓ Áp dụng chỉnh sửa" is an Apply like the one in the editor toolbar: it saves the mask AND puts that result on the 360 view.
async function mountApplyEditor(t: any) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setup(dom, () => ({ width: 200, height: 100 }));
  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const { api } = await importUnsafe('../lib/api');
  const ResultMaskEditor = (await importUnsafe('./ResultMaskEditor')).default;

  let resolveReproject!: (value: { equirectImageId: string }) => void;
  let rejectReproject!: (error: Error) => void;
  const reproject = t.mock.method(api.image, 'reproject', () => new Promise((resolve, reject) => {
    resolveReproject = resolve; rejectReproject = reject;
  }));
  const variant = { id: 'v', resultImageId: 'r', source: 'ai-generated', applied: false, width: 200, height: 100, createdAt: 1 };
  const other = { ...variant, id: 'other', resultImageId: 'o', createdAt: 2 };
  const store = useProjectStore.getState();
  store.reset();
  store.openImage('a.jpg', 10000, 5000);
  useProjectStore.setState({
    layers: [{
      ...LAYER, type: 'perspective', status: 'draft', variants: [variant, other],
      selection: { sourceView: '360', mode: 'free-select', rect: { x: 0, y: 0, width: 100, height: 100 }, viewport: { width: 1120, height: 761 },
        tileCoords: { x: 0, y: 0, w: 200, h: 100 }, viewPose: { yaw: 0, pitch: 0, roll: 0, fov: 60 }, prompt: '' },
    }],
    activeLayerId: 'layer', workflow: 'canvas-edit', reviewVariantId: 'other',
  } as any);
  const closed: string[] = [];
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => { root.render(createElement(ResultMaskEditor, { layerId: 'layer', variant, onClose: () => closed.push('closed') })); });
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const apply = () => container.querySelector('.result-mask-header-actions button.primary') as HTMLButtonElement;
  const layer = () => (useProjectStore.getState().layers as any[])[0];
  const close = async () => { await React.act(async () => { root.unmount(); }); dom.window.close(); };
  return { React, store: useProjectStore, container, apply, layer, closed, reproject, close,
    resolve: (id: string) => resolveReproject({ equirectImageId: id }), reject: (message: string) => rejectReproject(new Error(message)) };
}

test('Áp dụng chỉnh sửa saves the mask, looks at that result, applies it to the 360 view and then closes', async (t) => {
  const { React, store, apply, layer, closed, reproject, close, resolve } = await mountApplyEditor(t);
  try {
    assert.equal(apply().textContent, '✓ Áp dụng chỉnh sửa');
    await React.act(async () => { apply().click(); });

    assert.equal(layer().variants[0].visibilityMask?.base64Mask?.length > 0, true, 'the mask is saved on the result');
    assert.equal(store.getState().reviewVariantId, 'v', 'and that result is the one being looked at');
    assert.equal(reproject.mock.callCount(), 1);
    assert.equal(reproject.mock.calls[0].arguments[0].resultImageId, 'r');
    assert.equal(reproject.mock.calls[0].arguments[0].visibilityMask.base64Mask, layer().variants[0].visibilityMask.base64Mask);
    assert.equal(apply().textContent, 'Đang áp…');
    assert.equal(apply().disabled, true);
    assert.deepEqual(closed, [], 'it stays open until the 360 view has the result');
    assert.equal(layer().status, 'draft');

    await React.act(async () => { resolve('equirect-v'); await new Promise((r) => setTimeout(r, 5)); });

    assert.deepEqual(closed, ['closed']);
    assert.equal(layer().status, 'committed');
    assert.deepEqual(layer().variants.map((item: any) => [item.id, item.applied]), [['v', true], ['other', false]]);
    assert.equal(layer().equirectImageId, 'equirect-v');
  } finally {
    await close();
  }
});

test('when the 360 view cannot be updated the editor stays open, says why, and the mask is still saved', async (t) => {
  const { React, container, apply, layer, closed, close, reject } = await mountApplyEditor(t);
  try {
    await React.act(async () => { apply().click(); });
    await React.act(async () => { reject('server busy'); await new Promise((r) => setTimeout(r, 5)); });

    assert.match(container.querySelector('.result-mask-apply-error')!.textContent!, /server busy/);
    assert.deepEqual(closed, []);
    assert.equal(apply().disabled, false);
    assert.equal(apply().textContent, '✓ Áp dụng chỉnh sửa');
    assert.equal(layer().status, 'draft');
    assert.deepEqual(layer().variants.map((item: any) => item.applied), [false, false]);
    assert.equal(layer().variants[0].visibilityMask?.base64Mask?.length > 0, true);
  } finally {
    await close();
  }
});

// --- Defaults and the wheel / X shortcuts of the brush ---

// The mask canvas is the only one that gets filled: record the colour of each fill (canvas 2D is a no-op stub here).
function recordMaskFills(dom: any) {
  const fills: string[] = [];
  const proto = dom.window.HTMLCanvasElement.prototype;
  const getContext = proto.getContext;
  proto.getContext = function (...args: any[]) {
    const context = getContext.apply(this, args);
    if (!context.__recorded) {
      const fillRect = context.fillRect;
      context.fillRect = function (...rect: any[]) { fills.push(this.fillStyle); return fillRect.apply(this, rect); };
      context.__recorded = true;
    }
    return context;
  };
  return fills;
}

async function mountEditor(variant: any) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setup(dom, () => ({ width: 200, height: 100 }));
  const fills = recordMaskFills(dom);
  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const ResultMaskEditor = (await importUnsafe('./ResultMaskEditor')).default;
  useProjectStore.setState({ layers: [{ ...LAYER, variants: [variant] }] } as any);
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  await React.act(async () => { root.render(createElement(ResultMaskEditor, { layerId: 'layer', variant, onClose() {} })); });
  await settle();
  const button = (label: string) => (Array.from(container.querySelectorAll('button')) as HTMLButtonElement[])
    .find((item) => item.textContent?.includes(label))!;
  const readouts = () => Array.from(container.querySelectorAll('.result-mask-sliders strong')).map((item: any) => item.textContent);
  const wheel = (init: object) => container.querySelector('.result-mask-workspace')!
    .dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }));
  const close = async () => { await React.act(async () => { root.unmount(); }); dom.window.close(); };
  return { React, dom, container, fills, button, readouts, wheel, settle, close };
}

const FRESH_VARIANT = { id: 'v', resultImageId: 'r', source: 'ai-generated', applied: false, width: 200, height: 100, createdAt: 1 };

test('a result not refined yet opens hidden over the original, with a 200px restore brush and a 40% core', async () => {
  const { container, fills, button, readouts, close } = await mountEditor(FRESH_VARIANT);
  try {
    assert.deepEqual(fills, ['#000'], 'the whole result starts hidden, as after Xóa toàn bộ');
    assert.ok(button('ảnh gốc').textContent?.includes('Ẩn ảnh gốc'), 'the original is shown');
    assert.ok(button('Phục hồi').classList.contains('active'), 'the brush restores');
    assert.equal(button('Xóa').classList.contains('active'), false);
    assert.deepEqual(readouts(), ['200px', '100%', '40%']);
    assert.ok(container.querySelector('.result-mask-help-popover'));
  } finally {
    await close();
  }
});

test('a result refined before keeps its mask and the brush it was refined with', async () => {
  const variant = { ...FRESH_VARIANT, visibilityMask: { base64Mask: 'c2F2ZWQ=', brushSize: 120, brushOpacity: 90, brushHardness: 70, brushSoftness: 30 } };
  const { fills, readouts, close } = await mountEditor(variant);
  try {
    assert.equal(fills.includes('#000'), false, 'the saved mask is not wiped');
    assert.deepEqual(readouts(), ['120px', '90%', '70%']);
  } finally {
    await close();
  }
});

test('the wheel sizes the brush, Shift + wheel its core, and Ctrl + wheel still zooms', async () => {
  const { React, container, readouts, wheel, close } = await mountEditor(FRESH_VARIANT);
  const zoom = () => container.querySelector('.result-mask-zoom strong')!.textContent;
  try {
    let handled = true;
    await React.act(async () => { handled = !wheel({ deltaY: -100 }); });
    assert.equal(handled, true, 'the view does not scroll');
    assert.deepEqual(readouts(), ['220px', '100%', '40%'], 'wheel up grows the brush');
    await React.act(async () => { wheel({ deltaY: 100 }); wheel({ deltaY: 100 }); });
    assert.equal(readouts()[0], '182px', 'wheel down shrinks it');
    // With Shift held Chrome on Windows reports the wheel as horizontal.
    await React.act(async () => { wheel({ deltaX: -100, shiftKey: true }); });
    assert.deepEqual(readouts(), ['182px', '100%', '45%'], 'Shift + wheel up grows the core');
    await React.act(async () => { wheel({ deltaY: 100, shiftKey: true }); wheel({ deltaY: 100, shiftKey: true }); });
    assert.equal(readouts()[2], '35%');
    assert.equal(zoom(), '100%');
    await React.act(async () => { wheel({ deltaY: -100, ctrlKey: true }); });
    assert.equal(zoom(), '115%');
    assert.deepEqual(readouts(), ['182px', '100%', '35%'], 'zooming leaves the brush alone');
  } finally {
    await close();
  }
});

test('the wheel still sizes the brush after coming back from Căn chỉnh', async () => {
  const { React, button, readouts, wheel, settle, close } = await mountEditor(FRESH_VARIANT);
  try {
    await React.act(async () => { button('Căn chỉnh').click(); });
    await React.act(async () => { button('Mask').click(); });
    await settle();
    await React.act(async () => { wheel({ deltaY: -100 }); });
    assert.equal(readouts()[0], '220px');
  } finally {
    await close();
  }
});

test('X switches the brush between restore and erase, even right after using a slider', async () => {
  const { React, dom, container, button, close } = await mountEditor(FRESH_VARIANT);
  const press = (target: EventTarget, init: object = {}) =>
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true, ...init }));
  const erasing = () => button('Xóa').classList.contains('active');
  try {
    await React.act(async () => { press(dom.window.document.body); });
    assert.equal(erasing(), true);
    const slider = container.querySelector('.result-mask-sliders input') as HTMLInputElement;
    await React.act(async () => { press(slider); });
    assert.equal(erasing(), false, 'a focused slider does not swallow X');
    await React.act(async () => { press(dom.window.document.body, { ctrlKey: true }); });
    assert.equal(erasing(), false, 'Ctrl+X is not the shortcut');
  } finally {
    await close();
  }
});

test('the editor opens full screen and its button still shrinks it to the small popup', async () => {
  const { React, container, close } = await mountEditor(FRESH_VARIANT);
  const toggle = () => container.querySelector('.result-mask-header-actions button[aria-label$="popup"]') as HTMLButtonElement;
  try {
    assert.ok(container.querySelector('.result-mask-modal.fullscreen'), 'full screen at first');
    assert.equal(toggle().getAttribute('aria-label'), 'Thu nhỏ popup');
    await React.act(async () => { toggle().click(); });
    assert.equal(container.querySelector('.result-mask-modal.fullscreen'), null);
    assert.equal(toggle().getAttribute('aria-label'), 'Phóng to popup');
  } finally {
    await close();
  }
});
