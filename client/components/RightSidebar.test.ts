import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useState } from 'react';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

test('the right panel has a Khung cửa tab between Layers and Batch that shows the marks panel', async () => {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const RightSidebar = (await importUnsafe('./RightSidebar')).default;
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('a.jpg', 10000, 5000);
  useProjectStore.getState().addMarks([{ name: 'A', kind: 'window', yaw: [0, 10], pitch: [-5, 5] }]);

  const picked: string[] = [];
  const props = {
    tab: 'marks', onTab: (tab: string) => picked.push(tab), busy: false, canSave: false,
    onSave() {}, onSaveAs() {}, onAdd() {}, onEdit() {}, onBeforeExport() {}, onError() {},
  };
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(RightSidebar, props)));
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLElement[];
    assert.deepEqual(tabs.map((tab) => tab.textContent!.replace(/\s*\d+$/, '').trim()), ['Layers', 'Khung cửa', 'Batch']);
    assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['false', 'true', 'false']);
    assert.match(tabs[1].textContent!, /1$/, 'the tab counts the marks');
    assert.ok(container.querySelector('.marks-panel'), 'the marks panel is the body');
    assert.equal(container.querySelector('[role="tabpanel"]')!.getAttribute('aria-labelledby'), 'panel-tab-marks');

    await act(async () => tabs[1].click());
    await act(async () => tabs[0].click());
    assert.deepEqual(picked, ['marks', 'layers']);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

/** The sidebar with real tab state, the way App holds it, on a freshly opened 360 image. */
async function mountSidebarWithTabState() {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const RightSidebar = (await importUnsafe('./RightSidebar')).default;
  useProjectStore.getState().reset();
  useProjectStore.getState().openImage('a.jpg', 10000, 5000);
  const noop = () => {};
  function Harness() {
    const [tab, setTab] = useState('marks');
    return createElement(RightSidebar, {
      tab, onTab: setTab, busy: false, canSave: false,
      onSave: noop, onSaveAs: noop, onAdd: noop, onEdit: noop, onBeforeExport: noop, onError: noop,
    });
  }
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
  const typeInto = async (value: string) => {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(textarea, value);
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  const button = (text: string) => Array.from(container.querySelectorAll('button'))
    .find((element: any) => element.textContent?.trim() === text) as HTMLButtonElement;
  const selectedTab = () => container.querySelector('[role="tab"][aria-selected="true"]')!.textContent!;
  const close = async () => { await act(async () => root.unmount()); dom.window.close(); };
  return { container, typeInto, button, selectedTab, close };
}

test('a run that creates every layer moves on to the Layers tab', async (t) => {
  const { api } = await importUnsafe('../lib/api');
  t.mock.method(api.image, 'perspectiveRender', async (body: any) => (
    { resultImageId: 'tile', width: 640, height: 480, rect: body.rect }
  ));
  const { typeInto, button, selectedTab, close } = await mountSidebarWithTabState();
  try {
    await typeInto('Cửa A: yaw 70..110, pitch -10..25');
    await act(async () => button('Thêm').click());
    assert.match(selectedTab(), /^Khung cửa/);
    await act(async () => { button('Tạo layer crop').click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.match(selectedTab(), /^Layers/);
  } finally {
    await close();
  }
});

test('a run with one failed crop stays on the Khung cửa tab where the reason can be read', async (t) => {
  const { api } = await importUnsafe('../lib/api');
  let call = 0;
  t.mock.method(api.image, 'perspectiveRender', async (body: any) => {
    call += 1;
    if (call === 2) throw new Error('server busy'); // 1 = Chân máy, 2 = Cửa A
    return { resultImageId: 'tile', width: 640, height: 480, rect: body.rect };
  });
  const { container, typeInto, button, selectedTab, close } = await mountSidebarWithTabState();
  try {
    await typeInto('Cửa A: yaw 70..110, pitch -10..25');
    await act(async () => button('Thêm').click());
    await act(async () => { button('Tạo layer crop').click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.match(selectedTab(), /^Khung cửa/);
    assert.match(container.querySelector('.marks-errors')!.textContent!, /Cửa A: server busy/);
  } finally {
    await close();
  }
});
