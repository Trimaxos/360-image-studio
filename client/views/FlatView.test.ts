import { test, type TestContext } from 'node:test';
import assert from 'node:assert';
import { createElement } from 'react';
import type { ChangesOverlayRequest, Layer } from '../../shared/types';
import { setupDom } from '../test-utils/dom';
import { api } from '../lib/api';
import { useProjectStore } from '../stores/project';

function importUnsafe(specifier: string): Promise<any> {
  return import(specifier);
}

// Regression: zoom/pan from the viewing mode leaked into rect selection, but
// the selection overlay always maps against the contain-fit bounds — a
// zoomed-out view made the crop stop short of the image edges.
test('entering rect select resets zoom and pan so selection matches the fitted image', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);

  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const FlatView = (await importUnsafe('./FlatView')).default;

  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('/tmp/flat.jpg', 1920, 1080);

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => { root.render(createElement(FlatView)); });

    const view = container.querySelector('.flat-view-container') as HTMLElement;
    const stage = container.querySelector('.flat-stage') as SVGElement;
    assert.ok(view && stage, 'flat view renders image stage and container');

    await React.act(async () => {
      view.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: -500, bubbles: true, cancelable: true }));
    });
    assert.match(stage.style.transform, /scale\(1\.5\)/, 'wheel zooms the stage while viewing');

    const editHere = container.querySelector('.edit-here-btn') as HTMLButtonElement;
    await React.act(async () => { editHere.click(); });

    assert.equal(useProjectStore.getState().workflow, 'rect-select');
    assert.equal(stage.style.transform, 'translate(0px, 0px) scale(1)');
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});

async function mountFlat(width = 4000, height = 2000) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const FlatView = (await importUnsafe('./FlatView')).default;
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('/tmp/pano.jpg', width, height);
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => { root.render(createElement(FlatView)); });
  const close = async () => {
    await React.act(async () => {
      useProjectStore.getState().setMarksUi({ open: false, grid: true, draw: false });
      root.unmount();
    });
    dom.window.close();
  };
  return { dom, container, React, close };
}

test('the grid and the boxes are drawn on the flat image only while the Khung cửa panel is open', async () => {
  const { container, React, close } = await mountFlat();
  try {
    await React.act(async () => {
      useProjectStore.getState().addMarks([{ name: 'A', kind: 'window', yaw: [0, 10], pitch: [-5, 5] }]);
      useProjectStore.getState().setMarksUi({ open: false, grid: true, draw: false });
    });
    assert.equal(container.querySelectorAll('.marks-layer').length, 0, 'nothing is drawn while the panel is closed');

    await React.act(async () => { useProjectStore.getState().setMarksUi({ open: true }); });
    assert.equal(container.querySelectorAll('svg.flat-stage .marks-layer').length, 1);
    assert.equal(container.querySelectorAll('rect.marks-box').length, 1);
    assert.ok(container.querySelectorAll('line.marks-grid').length > 0, 'the grid is on');

    await React.act(async () => { useProjectStore.getState().setMarksUi({ grid: false }); });
    assert.equal(container.querySelectorAll('line.marks-grid').length, 0);
    assert.equal(container.querySelectorAll('rect.marks-box').length, 1, 'the boxes stay when only the grid is off');
  } finally {
    await close();
  }
});

test('while marking with the mouse the flat view shows the drawing overlay and ignores Edit Here, zoom and pan', async () => {
  const { dom, container, React, close } = await mountFlat();
  try {
    await React.act(async () => { useProjectStore.getState().setMarksUi({ open: true, draw: true }); });
    const view = container.querySelector('.flat-view-container') as HTMLElement;
    const stage = container.querySelector('svg.flat-stage') as SVGElement;
    assert.ok(container.querySelector('.marks-draw-overlay'), 'the drawing overlay is there');
    assert.equal(container.querySelector('.edit-here-btn'), null, 'Edit Here would fight the drawing overlay');

    await React.act(async () => {
      view.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: -500, bubbles: true, cancelable: true }));
    });
    assert.equal(stage.style.transform, 'translate(0px, 0px) scale(1)', 'wheel does not zoom while marking');

    await React.act(async () => {
      view.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 1, clientX: 0, clientY: 0 }));
      view.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 80, clientY: 40 }));
    });
    assert.equal(stage.style.transform, 'translate(0px, 0px) scale(1)', 'middle-button pan is off while marking');

    await React.act(async () => { useProjectStore.getState().setMarksUi({ draw: false }); });
    assert.equal(container.querySelector('.marks-draw-overlay'), null, 'the overlay goes away with the checkbox');
    assert.ok(container.querySelector('.edit-here-btn'), 'Edit Here is back');
  } finally {
    await close();
  }
});

// The Flat View is a clean map: layers are looked at in the 360 view (or, all at once, with "Xem thay đổi").
test('committed layers are not drawn on the Flat View', async () => {
  const fetched: string[] = [];
  (globalThis as any).fetch = async (url: unknown) => { fetched.push(String(url)); throw new Error('unexpected network request'); };
  const { container, React, close } = await mountFlat();
  const applied = (resultImageId: string, extra: object = {}) => ({
    id: `variant-${resultImageId}`, resultImageId, source: 'ai-generated' as const, applied: true,
    width: 640, height: 480, createdAt: 1, ...extra,
  });
  const layer = (id: string, order: number, type: 'flat' | 'perspective', variants: any[], extra: object = {}) => ({
    id, order, type, visible: true, yaw: 0, pitch: 0, roll: 0, fov: 60,
    tileCoords: { x: 10, y: 20, w: 640, h: 480 }, maskData: [], prompt: '', resultImageId: 'tile', status: 'committed' as const, variants, ...extra,
  });
  try {
    await React.act(async () => {
      useProjectStore.setState({
        layers: [
          layer('flat-layer', 1, 'flat', [applied('flat-result', { visibilityMask: { base64Mask: 'bWFzaw==', brushSize: 10, brushSoftness: 0 } })]),
          layer('layer-360', 2, 'perspective', [applied('360-result', { equirectImageId: 'equirect-hash' })], { equirectImageId: 'equirect-hash' }),
        ],
      });
    });
    assert.equal(container.querySelectorAll('image.flat-layer, image.flat-changes').length, 0);
    assert.equal(container.querySelectorAll('svg.flat-stage image').length, 1, 'only the original picture');
    assert.deepEqual(fetched, [], 'nothing is fetched or composed for the layers');
  } finally {
    await close();
  }
});

// --- "👁 Xem thay đổi": ONE merged overlay of the applied layers, built by the server ---

const appliedLayer = (id: string, order: number, over: Partial<Layer> = {}): Layer => ({
  id, order, type: 'perspective', visible: true, yaw: 0, pitch: 0, roll: 0, fov: 60,
  tileCoords: { x: 0, y: 0, w: 640, h: 480 }, maskData: [], prompt: '', resultImageId: `result-${id}`, status: 'committed',
  variants: [{ id: `variant-${id}`, resultImageId: `result-${id}`, source: 'ai-generated', applied: true, equirectImageId: `equirect-${id}`,
    width: 640, height: 480, createdAt: 1 }],
  ...over,
});
const withMask = (layer: Layer, base64Mask: string): Layer =>
  ({ ...layer, variants: [{ ...layer.variants![0], visibilityMask: { base64Mask, brushSize: 10, brushSoftness: 0 } }] });

/** Every call to the server is held until the test answers it, so the order of the answers is the test's to choose. */
function holdOverlayCalls(t: TestContext) {
  const calls: Array<{ body: ChangesOverlayRequest; answer(overlayId: string): void; fail(message: string): void }> = [];
  t.mock.method(api.image, 'changesOverlay', (body: ChangesOverlayRequest) => new Promise((resolve, reject) => {
    calls.push({ body, answer: (overlayId) => resolve({ overlayId, width: 4096, height: 2048 }), fail: (message) => reject(new Error(message)) });
  }));
  return calls;
}
const toggle = (container: Element) => container.querySelector('button.flat-changes-btn') as HTMLButtonElement | null;
const overlayImages = (container: Element) => Array.from(container.querySelectorAll('svg.flat-stage image.flat-changes'));
const layerIds = (call: { body: ChangesOverlayRequest }) => call.body.layers.map((layer) => layer.id);

test('the changes toggle appears only when a layer has an applied result, and only on the viewing screen', async () => {
  const { container, React, close } = await mountFlat();
  try {
    assert.equal(!!toggle(container), false, 'no layers');
    await React.act(async () => {
      useProjectStore.setState({ layers: [appliedLayer('draft', 1, { status: 'draft' }), appliedLayer('bare', 2, { variants: [] })] });
    });
    assert.equal(!!toggle(container), false, 'a draft and a layer without an applied result are not changes');

    await React.act(async () => { useProjectStore.setState({ layers: [appliedLayer('a', 1)] }); });
    assert.equal(!!toggle(container), true);
    assert.match(toggle(container)!.textContent ?? '', /Xem thay đổi/);

    await React.act(async () => { useProjectStore.setState({ workflow: 'rect-select' }); });
    assert.equal(!!toggle(container), false, 'not while selecting');
    await React.act(async () => { useProjectStore.setState({ workflow: 'viewing' }); });
    assert.equal(!!toggle(container), true);
  } finally {
    await close();
  }
});

test('turning the toggle on asks the server once for the applied, visible layers and draws one image under the grid and the boxes', async (t) => {
  const calls = holdOverlayCalls(t);
  const { container, React, close } = await mountFlat();
  try {
    await React.act(async () => {
      useProjectStore.setState({ layers: [appliedLayer('shown', 1), appliedLayer('hidden', 2, { visible: false }), appliedLayer('draft', 3, { status: 'draft' })] });
      useProjectStore.getState().addMarks([{ name: 'A', kind: 'window', yaw: [0, 10], pitch: [-5, 5] }]);
      useProjectStore.getState().setMarksUi({ open: true, grid: true, draw: false });
    });
    assert.equal(calls.length, 0, 'nothing is asked until the toggle is on');

    await React.act(async () => { toggle(container)!.click(); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.imagePath, '/tmp/pano.jpg');
    assert.deepEqual(layerIds(calls[0]), ['shown']);
    assert.equal(calls[0].body.maxWidth, 4096);
    assert.equal(toggle(container)!.getAttribute('aria-busy'), 'true');
    assert.equal(overlayImages(container).length, 0, 'nothing is drawn before the answer');

    await React.act(async () => { calls[0].answer('overlay-one'); });
    const images = overlayImages(container);
    assert.equal(images.length, 1);
    assert.match(images[0].getAttribute('href') ?? '', /\/api\/image\/cache\/overlay-one$/);
    assert.equal(images[0].getAttribute('pointer-events'), 'none', 'the picture never takes the mouse');
    assert.equal(toggle(container)!.getAttribute('aria-busy'), 'false');
    assert.equal(toggle(container)!.getAttribute('aria-pressed'), 'true');
    const stage = container.querySelector('svg.flat-stage')!;
    const order = Array.from(stage.children);
    assert.ok(order.indexOf(images[0]) > order.indexOf(stage.querySelector('image.flat-image')!), 'above the original');
    assert.ok(order.indexOf(images[0]) < order.indexOf(stage.querySelector('.marks-layer')!), 'below the grid and the boxes');

    await React.act(async () => { toggle(container)!.click(); });
    assert.equal(overlayImages(container).length, 0, 'off again');
    assert.equal(calls.length, 1, 'turning it off asks nothing');

    await React.act(async () => { toggle(container)!.click(); });
    assert.equal(calls.length, 2, 'on again asks again');
    assert.equal(overlayImages(container).length, 0, 'the old picture is not shown while the new one is built');
  } finally {
    await close();
  }
});

test('while it is on, a change of the applied layers asks again but edits that do not touch the picture do not', async (t) => {
  const calls = holdOverlayCalls(t);
  const { container, React, close } = await mountFlat();
  try {
    const a = appliedLayer('a', 1);
    const b = appliedLayer('b', 2);
    await React.act(async () => { useProjectStore.setState({ layers: [a] }); });
    await React.act(async () => { toggle(container)!.click(); });
    assert.equal(calls.length, 1);

    await React.act(async () => { useProjectStore.setState({ layers: [a, b] }); });
    assert.deepEqual(calls.map(layerIds), [['a'], ['a', 'b']], 'a layer was applied');

    await React.act(async () => { useProjectStore.setState({ layers: [{ ...a, visible: false }, b] }); });
    assert.deepEqual(layerIds(calls[2]), ['b'], 'the eye of a layer was turned off');

    await React.act(async () => { useProjectStore.setState({ layers: [{ ...a, visible: false, prompt: 'other words', name: 'renamed' }, { ...b, prompt: 'x' }] }); });
    assert.equal(calls.length, 3, 'prompts and names are not in the picture');

    await React.act(async () => { useProjectStore.setState({ layers: [{ ...a, visible: false }, withMask(b, 'bWFzaw==')] }); });
    assert.equal(calls.length, 4, 'a new mask changes the picture');
    await React.act(async () => { useProjectStore.setState({ layers: [{ ...a, visible: false }, withMask(b, 'bWFzaz==')] }); });
    assert.equal(calls.length, 5, 'another mask of the same length too');

    await React.act(async () => { calls[4].answer('overlay-masked'); });
    assert.equal(overlayImages(container).length, 1);
    await React.act(async () => { useProjectStore.setState({ layers: [{ ...a, visible: false }, { ...withMask(b, 'bWFzaz=='), visible: false }] }); });
    assert.equal(calls.length, 5, 'with every layer hidden there is nothing to ask for');
    assert.equal(overlayImages(container).length, 0, 'and nothing to draw');
    assert.equal(!!toggle(container), true, 'the toggle stays');
  } finally {
    await close();
  }
});

test('answers that arrive out of order, or after the toggle was turned off, are not drawn', async (t) => {
  const calls = holdOverlayCalls(t);
  const { container, React, close } = await mountFlat();
  try {
    const a = appliedLayer('a', 1);
    await React.act(async () => { useProjectStore.setState({ layers: [a] }); });
    await React.act(async () => { toggle(container)!.click(); });
    await React.act(async () => { useProjectStore.setState({ layers: [a, appliedLayer('b', 2)] }); });
    assert.equal(calls.length, 2);

    await React.act(async () => { calls[1].answer('overlay-new'); });
    await React.act(async () => { calls[0].answer('overlay-old'); }); // the older request finishes last
    const images = overlayImages(container);
    assert.equal(images.length, 1);
    assert.match(images[0].getAttribute('href') ?? '', /overlay-new$/, 'the newest request wins');

    await React.act(async () => { useProjectStore.setState({ layers: [a] }); });
    assert.equal(calls.length, 3);
    await React.act(async () => { toggle(container)!.click(); });
    await React.act(async () => { calls[2].answer('overlay-too-late'); });
    assert.equal(overlayImages(container).length, 0, 'turned off while it was being built');
  } finally {
    await close();
  }
});

test('a failed request shows its reason next to the toggle, draws nothing, and the toggle can be used again', async (t) => {
  const calls = holdOverlayCalls(t);
  const { container, React, close } = await mountFlat();
  try {
    await React.act(async () => { useProjectStore.setState({ layers: [appliedLayer('a', 1)] }); });
    await React.act(async () => { toggle(container)!.click(); });
    await React.act(async () => { calls[0].fail('Không dựng được: hết bộ nhớ'); });

    const error = container.querySelector('.flat-changes-error');
    assert.match(error?.textContent ?? '', /hết bộ nhớ/);
    assert.equal(overlayImages(container).length, 0);
    assert.equal(toggle(container)!.getAttribute('aria-busy'), 'false');

    await React.act(async () => { toggle(container)!.click(); }); // off
    assert.equal(!!container.querySelector('.flat-changes-error'), false, 'the reason goes away with the toggle');
    await React.act(async () => { toggle(container)!.click(); }); // on again
    assert.equal(calls.length, 2, 'a retry asks again');
    await React.act(async () => { calls[1].answer('overlay-ok'); });
    assert.equal(overlayImages(container).length, 1);
    assert.equal(!!container.querySelector('.flat-changes-error'), false);
  } finally {
    await close();
  }
});

test('the picture is hidden outside the viewing screen without asking again, and a newly opened image starts with the toggle off', async (t) => {
  const calls = holdOverlayCalls(t);
  const { container, React, close } = await mountFlat();
  try {
    await React.act(async () => { useProjectStore.setState({ layers: [appliedLayer('a', 1)] }); });
    await React.act(async () => { toggle(container)!.click(); });
    await React.act(async () => { calls[0].answer('overlay-one'); });
    assert.equal(overlayImages(container).length, 1);

    await React.act(async () => { useProjectStore.setState({ workflow: 'rect-select' }); });
    assert.equal(overlayImages(container).length, 0, 'not while selecting');
    await React.act(async () => { useProjectStore.setState({ workflow: 'viewing' }); });
    assert.equal(overlayImages(container).length, 1, 'back again');
    assert.equal(calls.length, 1, 'without a new request');

    await React.act(async () => {
      useProjectStore.getState().openImage('/tmp/another.jpg', 4000, 2000);
      useProjectStore.setState({ layers: [appliedLayer('a', 1)] });
    });
    assert.equal(overlayImages(container).length, 0, 'the old picture does not follow to a new image');
    assert.equal(toggle(container)!.getAttribute('aria-pressed'), 'false');
    assert.equal(calls.length, 1, 'and nothing is asked for it until the toggle is turned on');
  } finally {
    await close();
  }
});
