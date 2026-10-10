import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import sharp from 'sharp';
import type { Layer, LayerVariant } from '../shared/types';

// The picture folder is a constant of image-processor, read when it loads: point it at a temp folder before importing.
let root: string;
let cacheDir: string;
let panoramaPath: string;
let processor: typeof import('./services/image-processor');
let server: Server;
let api: string;

const PANORAMA = { width: 4000, height: 2000 };
const PANORAMA_COLOR = [30, 60, 90];
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const HORIZON = { yaw: 0, pitch: 0, roll: 0 };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const solid = (width: number, height: number, [r, g, b]: number[], alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { r, g, b, alpha } } });

/** A full-panorama transparent picture with one opaque block, like the picture a 360 layer is stored as. */
async function blockPicture(color: number[], block: { left: number; top: number; width: number; height: number }): Promise<Buffer> {
  const piece = await solid(block.width, block.height, color).png().toBuffer();
  return solid(PANORAMA.width, PANORAMA.height, [0, 0, 0], 0).composite([{ input: piece, left: block.left, top: block.top }]).png().toBuffer();
}

const savePicture = (id: string, buffer: Buffer) => fs.writeFile(path.join(cacheDir, `${id}.png`), buffer);

interface LayerOptions { layer?: Partial<Layer>; variant?: Partial<LayerVariant> }

const variantOf = (id: string, over: Partial<LayerVariant> = {}): LayerVariant => ({
  id: `variant-${id}`, resultImageId: `result-${id}`, source: 'ai-generated', applied: true, width: 400, height: 300, createdAt: 1, ...over,
});
const layerOf = (id: string, order: number, over: Partial<Layer>): Layer => ({
  id, order, type: 'flat', visible: true, yaw: 0, pitch: 0, roll: 0, fov: 60,
  tileCoords: { x: 0, y: 0, w: 400, h: 300 }, maskData: [], prompt: '', resultImageId: `result-${id}`, status: 'committed', ...over,
});

/** A 360 layer: its applied variant points to the pre-rendered full-panorama picture `equirect-<id>` that holds one block. */
async function layer360(id: string, order: number, color: number[], block: { left: number; top: number; width: number; height: number },
  options: LayerOptions = {}): Promise<Layer> {
  await savePicture(`equirect-${id}`, await blockPicture(color, block));
  await savePicture(`result-${id}`, await solid(8, 8, color).png().toBuffer()); // the variant picture itself must exist too
  return layerOf(id, order, {
    type: 'perspective', variants: [variantOf(id, { equirectImageId: `equirect-${id}`, ...options.variant })], ...options.layer,
  });
}

/** A flat layer: the 400x300 picture `result-<id>` sits at (x, y) of the original. */
async function flatLayer(id: string, order: number, at: { x: number; y: number; color: number[] }, options: LayerOptions = {}): Promise<Layer> {
  await savePicture(`result-${id}`, await solid(400, 300, at.color).png().toBuffer());
  return layerOf(id, order, { tileCoords: { x: at.x, y: at.y, w: 400, h: 300 }, variants: [variantOf(id, options.variant)], ...options.layer });
}

/** A mask that shows the left half of a 400x300 picture and hides the right half (or the other way round). */
async function halfMask(shown: 'left' | 'right'): Promise<NonNullable<LayerVariant['visibilityMask']>> {
  const raw = Buffer.alloc(400 * 300);
  for (let y = 0; y < 300; y++) raw.fill(255, y * 400 + (shown === 'left' ? 0 : 200), y * 400 + (shown === 'left' ? 200 : 400));
  const png = await sharp(raw, { raw: { width: 400, height: 300, channels: 1 } }).png().toBuffer();
  return { base64Mask: png.toString('base64'), brushSize: 10, brushSoftness: 0 };
}

/** Four 360 layers that must never reach the picture, each with a blue block of its own; `spots` are the block centres. */
async function layersThatAreSkipped(): Promise<{ layers: Layer[]; spots: Record<string, [number, number]> }> {
  const block = (index: number) => ({ left: 200, top: 100 + 300 * index, width: 400, height: 200 });
  const spot = (index: number): [number, number] => [400, 200 + 300 * index];
  const layers = [
    await layer360('draft', 10, BLUE, block(0), { layer: { status: 'draft' } }),
    await layer360('hidden', 11, BLUE, block(1), { layer: { visible: false } }),
    await layer360('not-applied', 12, BLUE, block(2), { variant: { applied: false } }),
    await layer360('needs-fit', 13, BLUE, block(3), { variant: { needsFit: true } }),
  ];
  return { layers, spots: { draft: spot(0), hidden: spot(1), 'not applied': spot(2), 'needs fit': spot(3) } };
}

/** Decode once, read many pixels. */
async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width, height: info.height,
    at: (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)),
  };
}
const near = (actual: number[], expected: number[], what = '') =>
  assert.ok(expected.every((value, i) => Math.abs(actual[i] - value) <= 3), `${what} expected about [${expected}] but got [${actual}]`);
const overlayPixels = async (overlay: { id: string }) => pixels(await fs.readFile(path.join(cacheDir, `${overlay.id}.png`)));
const WALL = { left: 3600, top: 1000, width: 400, height: 200 }; // touches the right edge of the panorama

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'changes-overlay-'));
  cacheDir = path.join(root, 'cache');
  await fs.mkdir(cacheDir);
  process.env.CACHE_DIR = cacheDir;
  panoramaPath = path.join(root, 'pano.png');
  await solid(PANORAMA.width, PANORAMA.height, PANORAMA_COLOR).png().toFile(panoramaPath);
  processor = await import('./services/image-processor');
  const { imageRouter } = await import('./routes/image');
  const app = express();
  app.use(express.json({ limit: '100mb' }));
  app.use('/api/image', imageRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/image`;
});

after(async () => {
  server.close();
  await fs.rm(root, { recursive: true, force: true });
});

// --- exportImage: the finished picture must not change when its pieces are shared with the overlay ---

test('export paints a 360 layer from its equirect picture and a masked flat layer at its tile, and skips what is not applied', async () => {
  const skipped = await layersThatAreSkipped();
  const layers = [
    await layer360('wall', 1, RED, WALL),
    await flatLayer('tile', 2, { x: 800, y: 600, color: GREEN }, { variant: { visibilityMask: await halfMask('left') } }),
    ...skipped.layers,
  ];

  const exported = await pixels(await processor.exportImage(panoramaPath, 'png', 90, layers, HORIZON));

  assert.deepEqual([exported.width, exported.height], [PANORAMA.width, PANORAMA.height]);
  near(exported.at(3800, 1100), RED, 'the 360 layer');
  near(exported.at(900, 750), GREEN, 'left half of the tile');
  near(exported.at(1100, 750), PANORAMA_COLOR, 'right half of the tile is hidden by the mask');
  near(exported.at(100, 100), PANORAMA_COLOR, 'untouched original');
  for (const [name, [x, y]] of Object.entries(skipped.spots)) near(exported.at(x, y), PANORAMA_COLOR, `${name} layer must not be painted`);
});

// --- buildChangesOverlay ---

test('the overlay is the applied 360 layer on a transparent picture of the asked width, a block at the right edge included', async () => {
  const layers = [await layer360('wall', 1, RED, WALL)];

  const overlay = await processor.buildChangesOverlay(panoramaPath, layers, 1000);
  const picture = await overlayPixels(overlay);

  assert.match(overlay.id, /^[a-f0-9]{64}$/, 'the id is a cache id the /cache route accepts');
  assert.deepEqual([overlay.width, overlay.height, picture.width, picture.height], [1000, 500, 1000, 500]);
  near(picture.at(950, 275), [...RED, 255], 'inside the block');
  near(picture.at(999, 275), [...RED, 255], 'the last column, at the right edge');
  assert.equal(picture.at(880, 275)[3], 0, 'left of the block');
  assert.equal(picture.at(950, 200)[3], 0, 'above the block');
  assert.equal(picture.at(100, 100)[3], 0, 'far from the block');
});

test('a flat layer lands at its scaled tile and what its mask hides stays transparent', async () => {
  const layers = [await flatLayer('tile', 1, { x: 800, y: 600, color: GREEN }, { variant: { visibilityMask: await halfMask('left') } })];

  const picture = await overlayPixels(await processor.buildChangesOverlay(panoramaPath, layers, 1000));

  // the 400x300 tile at (800, 600) becomes 100x75 at (200, 150) on the 1000x500 overlay
  near(picture.at(225, 185), [...GREEN, 255], 'left half of the tile');
  assert.equal(picture.at(275, 185)[3], 0, 'right half is hidden by the mask');
  assert.equal(picture.at(150, 185)[3], 0, 'left of the tile');
  assert.equal(picture.at(225, 120)[3], 0, 'above the tile');
  assert.equal(picture.at(225, 235)[3], 0, 'below the tile');
});

test('a flat layer in the bottom-right corner stays inside the overlay at an awkward width', async () => {
  const layers = [await flatLayer('corner', 1, { x: 3600, y: 1700, color: GREEN })];

  const overlay = await processor.buildChangesOverlay(panoramaPath, layers, 999);
  const picture = await overlayPixels(overlay);

  assert.deepEqual([overlay.width, overlay.height], [999, 500]);
  near(picture.at(990, 490), [...GREEN, 255], 'the corner of the tile');
  near(picture.at(998, 499), [...GREEN, 255], 'the very last pixel');
});

test('layers that are hidden, draft, not applied or waiting for a manual fit are not in the overlay', async () => {
  const skipped = await layersThatAreSkipped();
  const layers = [await layer360('wall', 1, RED, WALL), ...skipped.layers];

  const picture = await overlayPixels(await processor.buildChangesOverlay(panoramaPath, layers, 1000));

  near(picture.at(950, 275), [...RED, 255], 'the applied layer is there');
  for (const [name, [x, y]] of Object.entries(skipped.spots)) {
    assert.equal(picture.at(Math.round(x / 4), Math.round(y / 4))[3], 0, `${name} layer must not be in the overlay`);
  }
});

test('without any layer to show the overlay is a fully transparent picture, not an error', async () => {
  const skipped = await layersThatAreSkipped();

  for (const layers of [[], skipped.layers]) {
    const overlay = await processor.buildChangesOverlay(panoramaPath, layers, 1000);
    const alpha = (await sharp(path.join(cacheDir, `${overlay.id}.png`)).ensureAlpha().stats()).channels[3];
    assert.deepEqual([overlay.width, overlay.height, alpha.max], [1000, 500, 0]);
  }
});

test('the order decides which of two overlapping layers is on top, whatever order they are listed in', async () => {
  const red = await flatLayer('red', 1, { x: 0, y: 0, color: RED });        // 0..400 x 0..300
  const blue = await flatLayer('blue', 2, { x: 200, y: 100, color: BLUE }); // overlaps the lower right of red
  // on the 1000x500 overlay the overlap is x 50..100, y 25..75

  const blueOnTop = await processor.buildChangesOverlay(panoramaPath, [red, blue], 1000);
  const listedBackwards = await processor.buildChangesOverlay(panoramaPath, [blue, red], 1000);
  const redOnTop = await processor.buildChangesOverlay(panoramaPath, [{ ...red, order: 3 }, blue], 1000);

  near((await overlayPixels(blueOnTop)).at(75, 50), [...BLUE, 255], 'blue has the higher order');
  assert.equal(listedBackwards.id, blueOnTop.id, 'the same layers in another list order are the same picture');
  near((await overlayPixels(redOnTop)).at(75, 50), [...RED, 255], 'red moved above blue');
});

test('the same input gives the same overlay without building it again; other masks, layers or widths give another one', async () => {
  const layers = [await flatLayer('cached', 1, { x: 800, y: 600, color: GREEN }, { variant: { visibilityMask: await halfMask('left') } })];
  const first = await processor.buildChangesOverlay(panoramaPath, layers, 1000);
  const file = path.join(cacheDir, `${first.id}.png`);
  const past = new Date(Date.now() - 3600_000);
  await fs.utimes(file, past, past);

  const second = await processor.buildChangesOverlay(panoramaPath, layers, 1000);

  assert.deepEqual(second, first);
  assert.ok(Math.abs((await fs.stat(file)).mtimeMs - past.getTime()) < 5, 'the file was written again');

  const otherMask = [{ ...layers[0], variants: [{ ...layers[0].variants![0], visibilityMask: await halfMask('right') }] }];
  const ids = new Set([
    first.id,
    (await processor.buildChangesOverlay(panoramaPath, otherMask, 1000)).id,
    (await processor.buildChangesOverlay(panoramaPath, [], 1000)).id,
    (await processor.buildChangesOverlay(panoramaPath, layers, 2000)).id,
  ]);
  assert.equal(ids.size, 4, 'a new mask, a new layer set and a new width each make a different picture');
});

test('edits that cannot change a pixel (prompt, name, a result that is not applied) keep the same overlay', async () => {
  const layer = await flatLayer('stable', 1, { x: 800, y: 600, color: GREEN });
  const crowded = { ...layer, variants: [layer.variants![0], variantOf('older', { applied: false })] };
  const first = await processor.buildChangesOverlay(panoramaPath, [crowded], 1000);
  const file = path.join(cacheDir, `${first.id}.png`);
  const past = new Date(Date.now() - 3600_000);
  await fs.utimes(file, past, past);

  const edited = { ...crowded, prompt: 'other words', name: 'Renamed', variants: [...crowded.variants, variantOf('newer', { applied: false })] };
  const again = await processor.buildChangesOverlay(panoramaPath, [edited], 1000);

  assert.equal(again.id, first.id);
  assert.ok(Math.abs((await fs.stat(file)).mtimeMs - past.getTime()) < 5, 'it was built again');
  const moved = await processor.buildChangesOverlay(panoramaPath, [{ ...edited, tileCoords: { ...edited.tileCoords, x: 900 } }], 1000);
  assert.notEqual(moved.id, first.id, 'a moved tile is another picture');
});

test('a legacy layer that relies on the equirect picture stored on the layer is another picture once it has a second result', async () => {
  await savePicture('equirect-legacy', await blockPicture(RED, WALL));
  await savePicture('result-legacy', await solid(8, 8, RED).png().toBuffer());
  const legacy = layerOf('legacy', 1, { type: 'perspective', equirectImageId: 'equirect-legacy', variants: [variantOf('legacy')] }); // the applied result has no equirect picture of its own

  const alone = await processor.buildChangesOverlay(panoramaPath, [legacy], 1000);
  const crowded = await processor.buildChangesOverlay(panoramaPath,
    [{ ...legacy, variants: [...legacy.variants!, variantOf('second', { applied: false })] }], 1000);

  near((await overlayPixels(alone)).at(950, 275), [...RED, 255], 'a single result may use the picture stored on the layer');
  assert.notEqual(crowded.id, alone.id);
  assert.equal((await overlayPixels(crowded)).at(950, 275)[3], 0, 'with several results that picture may belong to another one and is not used');
});

test('the width never enlarges the picture, and without one the overlay is at most 4096 wide', async () => {
  const small = await processor.buildChangesOverlay(panoramaPath, [], 8000);
  const bigPath = path.join(root, 'big.png');
  await solid(8000, 4000, PANORAMA_COLOR).png().toFile(bigPath);
  const big = await processor.buildChangesOverlay(bigPath, []);

  assert.deepEqual([small.width, small.height], [4000, 2000]);
  assert.deepEqual([big.width, big.height], [4096, 2048]);
});

// --- POST /api/image/changes-overlay ---

test('POST /changes-overlay answers with the overlay id and size, and the cache route serves that picture', async () => {
  const layers = [await layer360('wall', 1, RED, WALL)];

  const response = await fetch(`${api}/changes-overlay`, { method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ imagePath: panoramaPath, layers, maxWidth: 1000 }) });

  assert.equal(response.status, 200);
  const body = await response.json() as { overlayId: string; width: number; height: number };
  assert.deepEqual([body.width, body.height], [1000, 500]);
  const picture = await fetch(`${api}/cache/${body.overlayId}`);
  assert.equal(picture.headers.get('content-type'), 'image/png');
  const decoded = await pixels(Buffer.from(await picture.arrayBuffer()));
  assert.deepEqual([decoded.width, decoded.height], [1000, 500]);
  near(decoded.at(950, 275), [...RED, 255]);
});

test('POST /changes-overlay without an image path is refused; no layers and a useless width fall back to the defaults', async () => {
  const post = (body: unknown) => fetch(`${api}/changes-overlay`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

  assert.equal((await post({ layers: [] })).status, 400);
  assert.equal((await post({ imagePath: '  ', layers: [] })).status, 400);
  for (const maxWidth of ['abc', 0, -5, null]) {
    const answered = await post({ imagePath: panoramaPath, maxWidth });
    assert.equal(answered.status, 200, `maxWidth ${JSON.stringify(maxWidth)}`);
    const body = await answered.json() as { width: number; height: number };
    assert.deepEqual([body.width, body.height], [4000, 2000], `maxWidth ${JSON.stringify(maxWidth)} means the default`);
  }
});

test('POST /changes-overlay reports an image that is not there', async () => {
  const response = await fetch(`${api}/changes-overlay`, { method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ imagePath: path.join(root, 'nope.png'), layers: [] }) });

  assert.equal(response.status, 500);
  assert.ok(((await response.json()) as { error: string }).error.length > 0);
});
