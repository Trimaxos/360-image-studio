import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { buildGridPrompt } from '../../shared/grid-tiles';
import { stubCanvas2d } from '../test-utils/canvas-stub';
import { setupDom } from '../test-utils/dom';

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

// 3000x1000 suggests 3x1 (default, 3 tiles) and 6x2 (6 tiles).
async function mountDialog(t: any, onConfirm: (base64: string, filled: number, total: number) => Promise<void> = async () => {}) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  stubCanvas2d(dom);
  const g = globalThis as any;
  const previousBitmap = g.createImageBitmap;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  let urlCount = 0;
  const revoked: string[] = [];
  URL.createObjectURL = () => `blob:tile-${urlCount += 1}`;
  URL.revokeObjectURL = (url: string) => { revoked.push(url); };
  g.createImageBitmap = async () => ({ width: 10, height: 10, close() {} });
  const { createRoot } = await importUnsafe('react-dom/client');
  const GridTilesDialog = (await importUnsafe('./GridTilesDialog')).default;
  const closed = { count: 0 };
  const confirmed: Array<[string, number, number]> = [];
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(GridTilesDialog, {
    sourceUrl: 'blob:source',
    getSourceBlob: async () => new dom.window.Blob(['x'], { type: 'image/png' }),
    width: 3000,
    height: 1000,
    onConfirm: async (base64: string, filled: number, total: number) => { confirmed.push([base64, filled, total]); await onConfirm(base64, filled, total); },
    onClose: () => { closed.count += 1; },
  })));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    g.createImageBitmap = previousBitmap;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  });
  const cell = (index: number) => container.querySelectorAll('.grid-tiles-cell')[index] as HTMLElement;
  const buttonByText = (text: string) => Array.from(container.querySelectorAll('button')).find((button: any) => button.textContent === text) as HTMLButtonElement;
  const drop = async (target: Element, files: unknown[]) => {
    const event = new dom.window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    await act(async () => { target.dispatchEvent(event); });
    return event;
  };
  const file = (type: string) => new dom.window.File(['x'], 'tile', { type });
  return { dom, container, cell, buttonByText, drop, file, closed, confirmed, revoked };
}

test('Xác nhận stays disabled until a tile is dropped into a cell', async (t) => {
  const { container, cell, buttonByText, drop, file } = await mountDialog(t);
  assert.equal(container.querySelectorAll('.grid-tiles-cell').length, 3);
  assert.equal(buttonByText('Xác nhận').disabled, true);

  await drop(cell(1), [file('image/png')]);

  assert.equal(cell(1).querySelector('img')!.getAttribute('src'), 'blob:tile-1');
  assert.equal(cell(0).querySelector('img'), null);
  assert.equal(buttonByText('Xác nhận').disabled, false);
});

test('a non-image file is refused and a drop without files explains how to get the tiles', async (t) => {
  const { container, cell, buttonByText, drop, file } = await mountDialog(t);

  await drop(cell(0), [file('text/plain')]);
  assert.match(container.querySelector('.modal-error')!.textContent!, /phải là ảnh/);
  assert.equal(cell(0).querySelector('img'), null);

  await drop(cell(0), []);
  assert.match(container.querySelector('.modal-error')!.textContent!, /tải tile về máy/);
  assert.equal(buttonByText('Xác nhận').disabled, true);
});

test('dropping on a filled cell replaces its tile, and the remove button clears it', async (t) => {
  const { cell, buttonByText, drop, file, revoked } = await mountDialog(t);
  await drop(cell(0), [file('image/png')]);
  await drop(cell(0), [file('image/jpeg')]);

  assert.equal(cell(0).querySelector('img')!.getAttribute('src'), 'blob:tile-2');
  assert.deepEqual(revoked, ['blob:tile-1']);

  await act(async () => (cell(0).querySelector('.grid-tiles-remove') as HTMLButtonElement).click());
  assert.equal(cell(0).querySelector('img'), null);
  assert.deepEqual(revoked, ['blob:tile-1', 'blob:tile-2']);
  assert.equal(buttonByText('Xác nhận').disabled, true);
});

test('two drops dispatched before React re-renders both survive', async (t) => {
  const { dom, cell, buttonByText, file, closed, confirmed } = await mountDialog(t);
  const dropEvent = (): Event => {
    const event = new dom.window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file('image/png')] } });
    return event;
  };
  await act(async () => {
    cell(0).dispatchEvent(dropEvent());
    cell(2).dispatchEvent(dropEvent());
  });

  assert.ok(cell(0).querySelector('img'));
  assert.ok(cell(2).querySelector('img'));
  await act(async () => buttonByText('Xác nhận').click());
  assert.deepEqual(confirmed, [['c3R1Yg==', 2, 3]]);
  assert.equal(closed.count, 1);
});

test('a drop outside every cell is swallowed so the browser does not open the file', async (t) => {
  const { container, drop, file } = await mountDialog(t);
  const event = await drop(container.querySelector('.modal-box')!, [file('image/png')]);
  assert.equal(event.defaultPrevented, true);
});

test('changing the grid clears the tiles and rewrites the prompt', async (t) => {
  const { dom, container, cell, drop, file, revoked } = await mountDialog(t);
  const prompt = () => container.querySelector('textarea') as HTMLTextAreaElement;
  assert.equal(prompt().value, buildGridPrompt(3, 1));
  await drop(cell(0), [file('image/png')]);

  const select = container.querySelector('select') as HTMLSelectElement;
  assert.deepEqual(Array.from(select.options).map((option) => option.textContent), ['3×1 · 3 tile', '6×2 · 12 tile']);
  await act(async () => {
    select.value = '1';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });

  assert.equal(container.querySelectorAll('.grid-tiles-cell').length, 12);
  assert.equal(container.querySelectorAll('.grid-tiles-cell img').length, 0);
  assert.equal(prompt().value, buildGridPrompt(6, 2));
  assert.deepEqual(revoked, ['blob:tile-1']);
});

test('Xác nhận composes the grid, hands the result over and closes', async (t) => {
  const { cell, buttonByText, drop, file, closed, confirmed } = await mountDialog(t);
  await drop(cell(0), [file('image/png')]);
  await drop(cell(2), [file('image/png')]);

  await act(async () => buttonByText('Xác nhận').click());

  assert.deepEqual(confirmed, [['c3R1Yg==', 2, 3]]);
  assert.equal(closed.count, 1);
});

test('a failed confirmation stays open, says why and can be retried', async (t) => {
  const { container, cell, buttonByText, drop, file, closed } = await mountDialog(t, async () => { throw new Error('server busy'); });
  await drop(cell(0), [file('image/png')]);

  await act(async () => buttonByText('Xác nhận').click());

  assert.match(container.querySelector('.modal-error')!.textContent!, /server busy/);
  assert.equal(closed.count, 0);
  assert.equal(buttonByText('Xác nhận').disabled, false);
});
