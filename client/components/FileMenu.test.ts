import { test } from 'node:test';
import assert from 'node:assert';
import { createElement } from 'react';
import { setupDom } from '../test-utils/dom';

function importUnsafe(specifier: string): Promise<any> {
  return import(specifier);
}

test('the File menu offers Save, Save As and Download, each wired to its own action', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const FileMenu = (await importUnsafe('./FileMenu')).default;
  const called: string[] = [];
  const props = {
    hasImage: true, canSave: true, canExport: true, isSaving: false, isLoading: false,
    onOpenImage: () => called.push('open'), onLoadProject: () => called.push('load'),
    onSave: () => called.push('save'), onSaveAs: () => called.push('saveAs'), onDownload: () => called.push('download'),
    onExport: () => called.push('export'), onNew: () => called.push('new'),
  };
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => { root.render(createElement(FileMenu, props)); });
    const click = async (label: RegExp) => {
      const button = Array.from(container.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) => label.test(b.textContent ?? ''));
      assert.ok(button, `button ${label}`);
      await React.act(async () => { button!.click(); });
    };
    await click(/^💾 Save Project$/);
    await click(/Save Project As/);
    await click(/Download Project/);
    await click(/Load Project/);
    assert.deepEqual(called, ['save', 'saveAs', 'download', 'load']);
    await React.act(async () => { root.render(createElement(FileMenu, { ...props, hasImage: false })); });
    const save = Array.from(container.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) => /^💾 Save Project$/.test(b.textContent ?? ''));
    assert.equal(save?.disabled, true, 'nothing to save without an image');
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});

test('Save and Save As wait for the viewing screen (unapplied canvas work is not part of the project), Download and the rest do not', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const FileMenu = (await importUnsafe('./FileMenu')).default;
  const props = {
    hasImage: true, canSave: false, canExport: true, isSaving: false, isLoading: false,
    onOpenImage() {}, onLoadProject() {}, onSave() {}, onSaveAs() {}, onDownload() {}, onExport() {}, onNew() {},
  };
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await React.act(async () => { root.render(createElement(FileMenu, props)); });
    const button = (label: RegExp) => Array.from(container.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) => label.test(b.textContent ?? ''))!;
    assert.equal(button(/^💾 Save Project$/).disabled, true);
    assert.equal(button(/Save Project As/).disabled, true);
    assert.match(button(/^💾 Save Project$/).title, /Apply/, 'the tooltip says what to do first');
    assert.equal(button(/Download Project/).disabled, false, 'a download is a plain copy and works in any step');
    assert.equal(button(/Load Project/).disabled, false);
    await React.act(async () => { root.render(createElement(FileMenu, { ...props, canSave: true })); });
    assert.equal(button(/^💾 Save Project$/).disabled, false);
    assert.equal(button(/Save Project As/).disabled, false);
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});

test('the Auto item is offered only when an auto handler is given, follows the Save rules and runs that handler', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const FileMenu = (await importUnsafe('./FileMenu')).default;
  const props = {
    hasImage: true, canSave: true, canExport: true, isSaving: false, isLoading: false,
    onOpenImage() {}, onLoadProject() {}, onSave() {}, onSaveAs() {}, onDownload() {}, onExport() {}, onNew() {},
  };
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    const auto = () => Array.from(container.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => /Auto: lưu vào assets\/output\/projects/.test(b.textContent ?? ''));
    await React.act(async () => { root.render(createElement(FileMenu, props)); });
    assert.equal(!!auto(), false, 'manual use never sees the Auto item');

    const called: string[] = [];
    const withAuto = { ...props, onAutoSave: () => called.push('auto') };
    await React.act(async () => { root.render(createElement(FileMenu, withAuto)); });
    assert.equal(auto()?.disabled, false);
    await React.act(async () => { auto()!.click(); });
    assert.deepEqual(called, ['auto']);

    for (const [name, over] of [['without an image', { hasImage: false }], ['before the viewing screen', { canSave: false }], ['while another save runs', { isSaving: true }]] as const) {
      await React.act(async () => { root.render(createElement(FileMenu, { ...withAuto, ...over })); });
      assert.equal(auto()?.disabled, true, `disabled ${name}`);
    }
    await React.act(async () => { root.render(createElement(FileMenu, { ...withAuto, canSave: false })); });
    assert.match(auto()?.title ?? '', /Apply/, 'the tooltip says what to do first, like Save');
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
  }
});

test('Ctrl+S saves, Ctrl+Shift+S saves as, other keys do nothing', async () => {
  const { saveShortcut } = await importUnsafe('./FileMenu');
  const key = (over: object) => ({ key: 's', ctrlKey: false, metaKey: false, shiftKey: false, ...over });
  assert.equal(saveShortcut(key({ ctrlKey: true })), 'save');
  assert.equal(saveShortcut(key({ key: 'S', ctrlKey: true, shiftKey: true })), 'saveAs');
  assert.equal(saveShortcut(key({ metaKey: true })), 'save');
  assert.equal(saveShortcut(key({})), null);
  assert.equal(saveShortcut(key({ key: 'a', ctrlKey: true })), null);
});
