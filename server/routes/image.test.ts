import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import sharp from 'sharp';
import { imageRouter } from './image';

let root: string;
let dir: string;
let server: Server;
let base: string;

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'serve-'));
  // Uploads live under ~/.cache, so the fixtures sit in a dot directory too.
  dir = path.join(root, '.cache');
  await fs.mkdir(dir);
  await solid(3000, 1500).jpeg().toFile(path.join(dir, 'pano.jpg'));
  await solid(3000, 1500).tiff({ compression: 'deflate' }).toFile(path.join(dir, 'pano.tif'));
  await solid(3000, 1500).jpeg().withMetadata({ orientation: 6 }).toFile(path.join(dir, 'rotated.jpg'));
  const app = express();
  app.use('/api/image', imageRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/image/serve`;
});

after(async () => {
  server.close();
  await fs.rm(root, { recursive: true, force: true });
});

const serve = (file: string, query = '') => fetch(`${base}?path=${encodeURIComponent(path.join(dir, file))}${query}`);
const metadataOf = async (response: Response) => sharp(Buffer.from(await response.arrayBuffer())).metadata();

test('serve without maxWidth sends the original file bytes, not a re-encoded PNG', async () => {
  const response = await serve('pano.jpg');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  const sent = Buffer.from(await response.arrayBuffer());
  assert.ok(sent.equals(await fs.readFile(path.join(dir, 'pano.jpg'))), 'body differs from the file on disk');
});

test('serve with maxWidth still returns a PNG scaled down to that width', async () => {
  const response = await serve('pano.jpg', '&maxWidth=1000');
  assert.equal(response.headers.get('content-type'), 'image/png');
  const { width, height, format } = await metadataOf(response);
  assert.deepEqual({ width, height, format }, { width: 1000, height: 500, format: 'png' });
});

test('serve converts a TIFF to PNG even without maxWidth because browsers cannot show it', async () => {
  const response = await serve('pano.tif');
  assert.equal(response.headers.get('content-type'), 'image/png');
  const { width, format } = await metadataOf(response);
  assert.deepEqual({ width, format }, { width: 3000, format: 'png' });
});

test('serve does not send a JPEG whose EXIF rotation the browser would apply but the server crops ignore', async () => {
  const response = await serve('rotated.jpg');
  assert.equal(response.headers.get('content-type'), 'image/png');
});
