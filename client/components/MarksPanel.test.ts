import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

/** keepProject: reopen the panel on the project that is already there (a tab closed and opened again). */
async function mountPanel(onCreated: () => void, keepProject = false) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  const { createRoot } = await importUnsafe('react-dom/client');
  const { useProjectStore } = await importUnsafe('../stores/project');
  const MarksPanel = (await importUnsafe('./MarksPanel')).default;
  if (!keepProject) {
    useProjectStore.getState().reset();
    useProjectStore.getState().openImage('a.jpg', 10000, 5000);
  }
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(MarksPanel, { onCreated })));
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
  const close = async () => { await act(async () => root.unmount()); dom.window.close(); };
  return { container, typeInto, button, close, store: useProjectStore };
}

test('the panel opens the map on mount and closes it on unmount', async () => {
  const { store, close } = await mountPanel(() => {});
  assert.equal(store.getState().marksUi.open, true);
  await close();
  assert.equal(store.getState().marksUi.open, false);
  assert.equal(store.getState().marksUi.draw, false);
});

test('adding lines keeps the good boxes, leaves only the bad lines in the box and says why', async () => {
  const { container, typeInto, button, store, close } = await mountPanel(() => {});
  try {
    await typeInto('Cửa A: yaw 70..110, pitch -10..25\nyaw 0..10\nCửa B: yaw 176..186, pitch -4..10');
    await act(async () => button('Thêm').click());
    assert.deepEqual(store.getState().marks.map((mark: any) => mark.name), ['Cửa A', 'Cửa B']);
    assert.equal((container.querySelector('textarea') as HTMLTextAreaElement).value, 'yaw 0..10');
    assert.match(container.querySelector('.marks-errors')!.textContent!, /Dòng 2/);
    assert.equal(container.querySelectorAll('.marks-list li').length, 2);
  } finally {
    await close();
  }
});

test('Tạo layer crop creates the layers, drops the finished boxes and opens the Layers tab', async (t) => {
  const { api } = await importUnsafe('../lib/api');
  t.mock.method(api.image, 'perspectiveRender', async (body: any) => (
    { resultImageId: 'tile', width: 640, height: 480, rect: body.rect }
  ));
  let created = 0;
  const { typeInto, button, store, close } = await mountPanel(() => { created += 1; });
  try {
    await typeInto('Cửa A: yaw 70..110, pitch -10..25');
    await act(async () => button('Thêm').click());
    await act(async () => {
      button('Tạo layer crop').click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.deepEqual(store.getState().layers.map((layer: any) => layer.name), ['Chân máy', 'Cửa A']);
    assert.deepEqual(store.getState().marks, []);
    assert.equal(created, 1);
  } finally {
    await close();
  }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const finished = { resultImageId: 'tile', width: 640, height: 480 };

test('a crop that fails keeps its box, says why, and does not switch to the Layers tab', async (t) => {
  const { api } = await importUnsafe('../lib/api');
  let call = 0;
  t.mock.method(api.image, 'perspectiveRender', async (body: any) => {
    call += 1;
    if (call === 2) throw new Error('server busy'); // 1 = Chân máy, 2 = Cửa A, 3 = Cửa B
    return { ...finished, rect: body.rect };
  });
  let created = 0;
  const { container, typeInto, button, store, close } = await mountPanel(() => { created += 1; });
  try {
    await typeInto('Cửa A: yaw 70..110, pitch -10..25\nCửa B: yaw -110..-70, pitch -10..25');
    await act(async () => button('Thêm').click());
    await act(async () => {
      button('Tạo layer crop').click();
      await sleep(30);
    });
    assert.deepEqual(store.getState().layers.map((layer: any) => layer.name), ['Chân máy', 'Cửa B']);
    assert.deepEqual(store.getState().marks.map((mark: any) => mark.name), ['Cửa A'], 'the failed box stays to be run again');
    assert.match(container.querySelector('.marks-errors')!.textContent!, /Cửa A: server busy/);
    assert.equal(created, 0, 'the operator stays here to read the message');
  } finally {
    await close();
  }
});

test('closing the tab mid-run and opening it again shows the progress and blocks a second run', async (t) => {
  const { api } = await importUnsafe('../lib/api');
  const renders: Array<(value: unknown) => void> = [];
  t.mock.method(api.image, 'perspectiveRender', () => new Promise((resolve) => { renders.push(resolve); }));
  let firstCreated = 0;
  let secondCreated = 0;
  const first = await mountPanel(() => { firstCreated += 1; });
  await first.typeInto('Cửa A: yaw 70..110, pitch -10..25');
  await act(async () => first.button('Thêm').click());
  await act(async () => { first.button('Tạo layer crop').click(); });
  assert.equal(first.button('Đang tạo 0/2…').disabled, true, 'the button is locked while the crops render');
  assert.equal(first.button('Xoá hết').disabled, true, 'the list is frozen while it is being run');
  assert.equal((first.container.querySelector('.marks-list li button') as HTMLButtonElement).disabled, true);
  await first.close();

  const second = await mountPanel(() => { secondCreated += 1; }, true);
  try {
    assert.equal(second.button('Đang tạo 0/2…').disabled, true, 'the new panel still sees the run');
    assert.equal(renders.length, 1, 'nothing was started twice');

    renders[0](finished);
    await act(async () => { await sleep(10); });
    assert.ok(second.button('Đang tạo 1/2…'), 'progress follows the run');
    renders[1](finished);
    await act(async () => { await sleep(10); });
    assert.deepEqual(second.store.getState().layers.map((layer: any) => layer.name), ['Chân máy', 'Cửa A']);
    assert.ok(second.button('Tạo layer crop'), 'the button is free again');
    assert.equal(firstCreated + secondCreated, 0, 'a panel that was closed does not pull the operator back to Layers');
  } finally {
    await second.close();
  }
});

test('running again does not add a second tripod layer, and unnamed boxes carry on the numbering', async (t) => {
  const { api } = await importUnsafe('../lib/api');
  t.mock.method(api.image, 'perspectiveRender', async (body: any) => ({ ...finished, rect: body.rect }));
  const { container, typeInto, button, store, close } = await mountPanel(() => {});
  const nadirBox = () => Array.from<any>(container.querySelectorAll('label'))
    .find((label) => label.textContent.includes('Thêm chân máy'))!.querySelector('input') as HTMLInputElement;
  try {
    assert.equal(nadirBox().checked, true, 'the first run adds the tripod');
    await typeInto('yaw 70..110, pitch -10..25');
    await act(async () => button('Thêm').click());
    await act(async () => { button('Tạo layer crop').click(); await sleep(30); });
    assert.deepEqual(store.getState().layers.map((layer: any) => layer.name), ['Chân máy', 'Cửa 1']);
    assert.equal(nadirBox().checked, false, 'the tripod already has its layer');

    await typeInto('yaw -110..-70, pitch -10..25');
    await act(async () => button('Thêm').click());
    assert.deepEqual(store.getState().marks.map((mark: any) => mark.name), ['Cửa 2'], 'the numbering goes on after the layers');
    await act(async () => { button('Tạo layer crop').click(); await sleep(30); });
    assert.deepEqual(store.getState().layers.map((layer: any) => layer.name), ['Chân máy', 'Cửa 1', 'Cửa 2']);
  } finally {
    await close();
  }
});
