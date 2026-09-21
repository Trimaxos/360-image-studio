import { test } from 'node:test';
import assert from 'node:assert';
import { createElement } from 'react';
import { setupDom } from '../test-utils/dom';
import { useProjectStore } from '../stores/project';

function importUnsafe(specifier: string): Promise<any> {
  return import(specifier);
}

function makeCommittedFlatLayer(): string {
  const store = useProjectStore.getState();
  store.reset();
  store.openImage('/tmp/flat.jpg', 1920, 1080);
  store.createPerspectiveLayer({
    sourceView: 'flat',
    mode: 'free-select',
    rect: { x: 0, y: 0, width: 100, height: 100 },
    viewport: { width: 800, height: 600 },
    tileCoords: { x: 10, y: 20, w: 400, h: 300 },
    viewPose: { yaw: 0, pitch: 0, roll: 0, fov: 90 },
    prompt: '',
  }, '', 400, 300);
  const layerId = useProjectStore.getState().activeLayerId!;
  useProjectStore.getState().addVariantToLayer(layerId, {
    id: 'v1', resultImageId: 'hash1', source: 'ai-generated',
    applied: false, width: 400, height: 300, createdAt: 1,
  });
  useProjectStore.getState().selectVariantForEditing(layerId, 'v1');
  useProjectStore.getState().leaveCanvas('save');
  return layerId;
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

// Regression: the view re-composited the whole panorama on the server on every
// visibility toggle (~seconds for large images). Layers must render client-side
// like the 360 viewer, so hiding/showing is a CSS-only change.
test('committed layers render client-side and visibility toggles without a server composite', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);

  const fetchCalls: string[] = [];
  (globalThis as any).fetch = async (url: unknown) => {
    fetchCalls.push(String(url));
    throw new Error('unexpected network request');
  };

  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const FlatView = (await importUnsafe('./FlatView')).default;

  const layerId = makeCommittedFlatLayer();

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => { root.render(createElement(FlatView)); });

    const stage = container.querySelector('svg.flat-stage');
    const overlay = container.querySelector('image.flat-layer') as SVGImageElement | null;
    assert.ok(stage, 'flat view renders the layered stage');
    assert.ok(overlay, 'committed layer renders as an overlay image');
    assert.equal(overlay!.getAttribute('href'), '/api/image/cache/hash1');
    assert.equal(overlay!.getAttribute('x'), '10');
    assert.equal(overlay!.getAttribute('y'), '20');
    assert.equal(overlay!.getAttribute('width'), '400');
    assert.equal(overlay!.getAttribute('height'), '300');

    await React.act(async () => { useProjectStore.getState().toggleLayerVisibility(layerId); });
    assert.equal(overlay!.style.display, 'none', 'hiding a layer is instant (CSS only)');

    await React.act(async () => { useProjectStore.getState().toggleLayerVisibility(layerId); });
    assert.notEqual(overlay!.style.display, 'none', 'showing a layer is instant (CSS only)');

    assert.equal(
      fetchCalls.filter((url) => url.includes('/api/image/preview')).length,
      0,
      'view must not request a server composite',
    );
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});
