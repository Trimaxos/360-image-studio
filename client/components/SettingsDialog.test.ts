import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

const saved = { ninerouterBaseUrl: 'http://gateway/v1', ninerouterKey: '…abcd', falAiKey: null };

async function mountDialog(t: any) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useSettingsStore } = await importUnsafe('../stores/settings');
  const { api } = await importUnsafe('../lib/api');
  const SettingsDialog = (await importUnsafe('./SettingsDialog')).default;
  useSettingsStore.setState({ status: saved, open: false });
  t.mock.method(api.settings, 'get', async () => saved);
  const sent: any[] = [];
  const save = t.mock.method(api.settings, 'save', async (body: any) => {
    sent.push(body);
    return { ...saved, ...body, ninerouterKey: body.ninerouterKey ? `…${body.ninerouterKey.slice(-4)}` : saved.ninerouterKey, falAiKey: body.falAiKey ? `…${body.falAiKey.slice(-4)}` : null };
  });
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(SettingsDialog)));
  await act(async () => useSettingsStore.getState().setOpen(true));
  const field = (label: string) => container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  const typeInto = async (label: string, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(field(label), value);
      field(label).dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  const button = (text: string) => Array.from(container.querySelectorAll('button'))
    .find((element: any) => element.textContent?.trim() === text) as HTMLButtonElement;
  const close = async () => { await act(async () => root.unmount()); dom.window.close(); };
  return { container, field, typeInto, button, close, sent, save, store: useSettingsStore };
}

test('Settings shows the URL and only the end of the saved keys, never the keys themselves', async (t) => {
  const { field, close } = await mountDialog(t);
  try {
    assert.equal(field('URL 9router').value, 'http://gateway/v1');
    assert.equal(field('API key 9router').type, 'password');
    assert.equal(field('API key 9router').value, '');
    assert.match(field('API key 9router').placeholder, /…abcd/);
    assert.match(field('Key fal.ai').placeholder, /Chưa nhập/);
  } finally {
    await close();
  }
});

test('Save sends only what was changed, then closes with the new status', async (t) => {
  const { typeInto, button, sent, store, container, close } = await mountDialog(t);
  try {
    await typeInto('Key fal.ai', '  fal-new-key-9876  ');
    await act(async () => button('Lưu').click());
    assert.deepEqual(sent, [{ falAiKey: 'fal-new-key-9876' }]);
    assert.equal(store.getState().open, false);
    assert.equal(store.getState().status.falAiKey, '…9876');
    assert.equal(container.querySelector('[role=dialog]'), null);
  } finally {
    await close();
  }
});

test('a refused save keeps the dialog open with the reason', async (t) => {
  const { typeInto, button, save, store, container, close } = await mountDialog(t);
  try {
    save.mock.mockImplementation(async () => { throw new Error('URL 9router không hợp lệ'); });
    await typeInto('URL 9router', 'nope');
    await act(async () => button('Lưu').click());
    assert.equal(store.getState().open, true);
    assert.match(container.querySelector('.modal-error')!.textContent!, /URL 9router không hợp lệ/);
  } finally {
    await close();
  }
});
