import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

async function renderConfirm(t: any, props: { busy?: boolean; canSave?: boolean }) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const { createRoot } = await importUnsafe('react-dom/client');
  const BatchSaveConfirm = (await importUnsafe('./BatchSaveConfirm')).default;
  const calls: string[] = [];
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const buttons = () => Array.from(container.querySelectorAll('.modal-actions button')) as HTMLButtonElement[];
  const render = async (next: { busy?: boolean; canSave?: boolean } = {}) => {
    await act(async () => root.render(createElement(BatchSaveConfirm, {
      busy: next.busy ?? props.busy ?? false,
      canSave: next.canSave ?? props.canSave ?? true,
      onCancel: () => calls.push('cancel'),
      onContinue: (save: boolean) => calls.push(save ? 'save' : 'discard'),
    })));
  };
  await render();
  t.after(async () => { await act(async () => root.unmount()); });
  return { calls, buttons, render, container };
}

test('cancelling closes the dialog without continuing', async (t) => {
  const { calls, buttons } = await renderConfirm(t, {});
  await act(async () => buttons()[0].click());
  assert.deepEqual(calls, ['cancel']);
});

test('discard and save are reported as distinct decisions', async (t) => {
  const discard = await renderConfirm(t, {});
  await act(async () => discard.buttons()[1].click());
  assert.deepEqual(discard.calls, ['discard']);

  const save = await renderConfirm(t, {});
  await act(async () => save.buttons()[2].click());
  assert.deepEqual(save.calls, ['save']);
});

test('busy disables every action so a pending change cannot be lost twice', async (t) => {
  const { buttons, calls } = await renderConfirm(t, { busy: true });
  assert.deepEqual(buttons().map((button) => button.disabled), [true, true, true]);
  await act(async () => buttons().forEach((button) => button.click()));
  assert.deepEqual(calls, []);
});

test('saving is blocked when the project cannot be saved yet but discarding stays available', async (t) => {
  const { buttons, calls, container } = await renderConfirm(t, { canSave: false });
  assert.deepEqual(buttons().map((button) => button.disabled), [false, false, true]);
  assert.match(container.textContent ?? '', /Apply/);
  await act(async () => buttons()[1].click());
  assert.deepEqual(calls, ['discard']);
});
