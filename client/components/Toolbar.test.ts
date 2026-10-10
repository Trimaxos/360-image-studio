import { test } from 'node:test';
import assert from 'node:assert';
import { createElement } from 'react';
import { useProjectStore } from '../stores/project';
import { setupDom } from '../test-utils/dom';

function importUnsafe(specifier: string): Promise<any> {
  return import(specifier);
}

test('the sidebar Save button waits for the viewing screen, like the File menu and the Batch panel', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const Toolbar = (await importUnsafe('./Toolbar')).default;
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('/uploads/source.jpg', 1000, 500);
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const save = () => Array.from(container.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) => /Save Project/.test(b.textContent ?? ''))!;
  try {
    await React.act(async () => { root.render(createElement(Toolbar, { onExport() {}, onSave() {}, isSaving: false })); });
    assert.equal(save().disabled, false, 'viewing: Save works');
    await React.act(async () => { useProjectStore.setState({ workflow: 'canvas-edit' }); });
    assert.equal(save().disabled, true, 'canvas work that was not applied yet: Save waits');
    assert.match(save().title, /Apply/, 'and says what to do first');
    await React.act(async () => { useProjectStore.setState({ workflow: 'viewing' }); });
    assert.equal(save().disabled, false);
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
    useProjectStore.getState().reset();
  }
});
