import test from 'node:test';
import assert from 'node:assert/strict';
import { gridCells } from '../../shared/grid-tiles';
import { stubCanvas2d } from '../test-utils/canvas-stub';
import { setupDom } from '../test-utils/dom';
import { composeGridTiles, coverSourceRect } from './canvas-exchange';

test('manual result with matching aspect ratio uses the full image', () => {
  assert.deepEqual(
    coverSourceRect({ width: 800, height: 600 }, { width: 400, height: 300 }),
    { sx: 0, sy: 0, sw: 800, sh: 600 },
  );
});

test('manual result is center-cropped when its aspect ratio differs', () => {
  assert.deepEqual(
    coverSourceRect({ width: 1000, height: 1000 }, { width: 800, height: 400 }),
    { sx: 0, sy: 250, sw: 1000, sh: 500 },
  );
});

async function importUnsafe(specifier: string): Promise<any> { return import(specifier); }

async function composeFixture(t: any) {
  const { JSDOM } = await importUnsafe('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  setupDom(dom);
  stubCanvas2d(dom);
  const draws: number[][] = [];
  const proto = dom.window.HTMLCanvasElement.prototype as any;
  const getContext = proto.getContext;
  proto.getContext = function () {
    const context = getContext.call(this);
    context.drawImage = (_bitmap: unknown, ...rect: number[]) => { draws.push(rect); };
    return context;
  };
  const previous = (globalThis as any).createImageBitmap;
  const counts = { opened: 0, closed: 0 };
  (globalThis as any).createImageBitmap = async (blob: Blob) => {
    if (blob.type === 'image/bad') throw new Error('decode failed');
    counts.opened += 1;
    return { width: 50, height: 50, close() { counts.closed += 1; } };
  };
  t.after(() => { (globalThis as any).createImageBitmap = previous; dom.window.close(); });
  return { draws, counts };
}

test('composeGridTiles stretches the source underneath and each filled cell over its exact rect', async (t) => {
  const { draws, counts } = await composeFixture(t);
  const cells = gridCells(300, 200, 3, 2);
  const png = new Blob(['x'], { type: 'image/png' });
  const base64 = await composeGridTiles(png, 300, 200, cells, [null, png, null, null, null, png]);

  assert.equal(base64, 'c3R1Yg==');
  assert.deepEqual(draws, [
    [0, 0, 300, 200],
    [cells[1].x, cells[1].y, cells[1].w, cells[1].h],
    [cells[5].x, cells[5].y, cells[5].w, cells[5].h],
  ]);
  assert.equal(counts.opened, 3);
  assert.equal(counts.closed, 3);
});

test('composeGridTiles closes every decoded bitmap even when a later tile fails to decode', async (t) => {
  const { counts } = await composeFixture(t);
  const cells = gridCells(300, 200, 3, 2);
  const png = new Blob(['x'], { type: 'image/png' });
  const bad = new Blob(['x'], { type: 'image/bad' });

  await assert.rejects(composeGridTiles(png, 300, 200, cells, [png, bad, null, null, null, null]), /decode failed/);
  assert.equal(counts.opened, 2);
  assert.equal(counts.closed, 2);
});
