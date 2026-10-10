import { test } from 'node:test';
import assert from 'node:assert';
import { createElement } from 'react';
import { setupDom } from '../test-utils/dom';

function importUnsafe(specifier: string): Promise<any> {
  return import(specifier);
}

async function renderPanel(window: Record<string, unknown> = {}) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  Object.assign(dom.window, window);
  const React = await importUnsafe('react');
  const { createRoot } = await importUnsafe('react-dom/client');
  const BatchPanel = (await importUnsafe('./BatchPanel')).default;
  const calls: Array<[string, unknown?]> = [];
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(createElement(BatchPanel, {
      busy: false, canSave: true,
      onSave: () => calls.push(['save']), onSaveAs: () => calls.push(['saveAs']),
      onAdd: (entries: unknown) => calls.push(['add', entries]),
      onEdit: () => calls.push(['edit']), onBeforeExport: () => calls.push(['export']),
      onError: (message: string) => calls.push(['error', message]),
    }));
  });
  const button = (label: RegExp) => Array.from(container.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
    .find((b) => label.test(b.textContent ?? ''))!;
  const close = async () => { await React.act(async () => { root.unmount(); }); dom.window.close(); };
  return { React, dom, container, calls, button, close };
}

test('the batch panel saves in place with "Lưu" and to a new file with "Lưu thành…"', async () => {
  const view = await renderPanel();
  try {
    await view.React.act(async () => { view.button(/^💾 Lưu$/).click(); });
    await view.React.act(async () => { view.button(/Lưu thành/).click(); });
    assert.deepEqual(view.calls.map(([name]) => name), ['save', 'saveAs']);
  } finally { await view.close(); }
});

test('"Thêm project cũ" opens files with handles when the browser can, else falls back to the file input', async () => {
  const handle = { name: 'A.360project', async getFile() { return { name: 'A.360project' }; } };
  const picked = await renderPanel({ showOpenFilePicker: async (options: { multiple: boolean }) => {
    assert.equal(options.multiple, true);
    return [handle];
  } });
  try {
    await picked.React.act(async () => { picked.button(/Thêm project cũ/).click(); });
    await picked.React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const add = picked.calls.find(([name]) => name === 'add');
    assert.ok(add, 'onAdd called');
    assert.deepEqual(add![1], [{ file: { name: 'A.360project' }, handle }]);
  } finally { await picked.close(); }

  const plain = await renderPanel();
  try {
    let inputClicks = 0;
    const input = plain.container.querySelector('input[type=file][multiple]') as HTMLInputElement;
    input.click = () => { inputClicks++; };
    await plain.React.act(async () => { plain.button(/Thêm project cũ/).click(); });
    await plain.React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    assert.equal(inputClicks, 1);
    assert.equal(plain.calls.some(([name]) => name === 'add'), false);
  } finally { await plain.close(); }
});

test('a failure to open project files is reported to the app (its error banner), not hidden inside the export dialog; cancelling the picker is silent', async () => {
  const failing = await renderPanel({ showOpenFilePicker: async () => { throw new Error('Không đọc được file'); } });
  try {
    await failing.React.act(async () => { failing.button(/Thêm project cũ/).click(); });
    await failing.React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const errors = failing.calls.filter(([name]) => name === 'error');
    assert.equal(errors.length, 1);
    assert.match(String(errors[0][1]), /Không mở được project.*Không đọc được file/);
    assert.equal(failing.container.querySelector('.modal-error'), null, 'the export dialog is not even open');
  } finally { await failing.close(); }

  const cancelled = await renderPanel({ showOpenFilePicker: async () => { throw Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }); } });
  try {
    await cancelled.React.act(async () => { cancelled.button(/Thêm project cũ/).click(); });
    await cancelled.React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    assert.deepEqual(cancelled.calls.filter(([name]) => name === 'error'), []);
  } finally { await cancelled.close(); }
});
