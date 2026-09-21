import { test } from 'node:test';
import assert from 'node:assert';
import { createElement } from 'react';
import type { Layer, LayerVariant } from '../../shared/types';
import { setupDom } from '../test-utils/dom';

// Dynamic imports must live in this file so relative specifiers resolve
// against it; the helper hides them from tsc (jsdom ships no types).
function importUnsafe(specifier: string): Promise<any> {
  return import(specifier);
}

// Regression: the transform editor's tile selector used to build a fresh
// { w, h } object on every call. zustand v5 feeds selectors straight into
// useSyncExternalStore, so an unstable snapshot triggers an endless re-render
// loop; with no error boundary that unmounts the whole app (blank page) and
// loses the in-memory project.
test('variant transform editor mounts without crashing the React tree', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);

  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const VariantTransformEditor = (await importUnsafe('./VariantTransformEditor')).default;

  const layer: Layer = {
    id: 'layer', order: 1, type: 'flat', visible: true,
    yaw: 0, pitch: 0, roll: 0, fov: 90,
    tileCoords: { x: 0, y: 0, w: 100, h: 50 },
    maskData: [], prompt: '', resultImageId: 'original', status: 'committed',
  };
  const variant: LayerVariant = {
    id: 'variant', resultImageId: 'full-size', source: 'imported', applied: false,
    width: 200, height: 50, needsFit: true, createdAt: 1,
  };
  useProjectStore.setState({ layers: [layer] } as any);

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(createElement(VariantTransformEditor, {
        layerId: 'layer', variant, originalUrl: '', onCommit() {}, onCancel() {},
      }));
    });
    assert.ok(
      container.innerHTML.includes('variant-transform'),
      'transform editor phải còn mounted (app không bị unmount)',
    );
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});
