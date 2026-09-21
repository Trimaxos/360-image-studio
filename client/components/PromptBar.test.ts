import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

test('model can be chosen before cropping but is locked during generation', async (t) => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const { api } = await importUnsafe('../lib/api');
  const PromptBar = (await importUnsafe('./PromptBar')).default;
  const model = { id: 'gpt-test', provider: 'fal', displayName: 'GPT', enabled: true, supportsCustomImageSize: true };
  t.mock.method(api.ai, 'models', async () => ({ groups: [{ provider: 'fal', label: 'fal', models: [model] }] }));
  useProjectStore.getState().reset();
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(PromptBar)));
    for (const workflow of ['viewing', 'rect-select', 'canvas-edit', 'generating']) {
      await act(async () => useProjectStore.setState({ workflow }));
      const select = container.querySelector('select[aria-label=Model]') as HTMLSelectElement;
      assert.equal(select.disabled, workflow === 'generating', workflow);
    }
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
