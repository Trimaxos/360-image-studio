import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBase64Mask, exportableLayers } from './image-processor';
import type { Layer } from '../../shared/types';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const makeLayer = (id: string, status: Layer['status'], visible: boolean): Layer => ({
  id, status, visible, order: 1, type: 'flat',
  yaw: 0, pitch: 0, roll: 0, fov: 90,
  tileCoords: { x: 0, y: 0, w: 10, h: 10 },
  maskData: [], prompt: '', resultImageId: id,
});

test('export uses only visible committed layers', () => {
  const layers = [
    makeLayer('draft', 'draft', true),
    makeLayer('hidden', 'committed', false),
    makeLayer('ready', 'committed', true),
  ];
  assert.deepEqual(exportableLayers(layers).map((layer) => layer.id), ['ready']);
});

test('flat selection mask becomes result alpha', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-mask-'));
  const resultPath = path.join(directory, 'result.png');
  await sharp({
    create: { width: 2, height: 1, channels: 3, background: '#ff0000' },
  }).png().toFile(resultPath);
  const mask = await sharp(Buffer.from([0, 255]), {
    raw: { width: 2, height: 1, channels: 1 },
  }).png().toBuffer();
  const output = await applyBase64Mask(resultPath, mask.toString('base64'));
  const pixels = await sharp(output).ensureAlpha().raw().toBuffer();
  assert.equal(pixels[3], 0);
  assert.equal(pixels[7], 255);
  await fs.rm(directory, { recursive: true });
});
