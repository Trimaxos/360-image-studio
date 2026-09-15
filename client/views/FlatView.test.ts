import { test } from 'node:test';
import assert from 'node:assert';
import { createElement } from 'react';
import { setupDom } from '../test-utils/dom';

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

  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { useProjectStore } = await import('../stores/project');
  const FlatView = (await import('./FlatView')).default;

  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('/tmp/flat.jpg', 1920, 1080);

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => { root.render(createElement(FlatView)); });

    const view = container.querySelector('.flat-view-container') as HTMLElement;
    const image = container.querySelector('.flat-image') as HTMLImageElement;
    assert.ok(view && image, 'flat view renders image and container');

    await React.act(async () => {
      view.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: -500, bubbles: true, cancelable: true }));
    });
    assert.match(image.style.transform, /scale\(1\.5\)/, 'wheel zooms the image while viewing');

    const editHere = container.querySelector('.edit-here-btn') as HTMLButtonElement;
    await React.act(async () => { editHere.click(); });

    assert.equal(useProjectStore.getState().workflow, 'rect-select');
    assert.equal(image.style.transform, 'translate(0px, 0px) scale(1)');
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});
