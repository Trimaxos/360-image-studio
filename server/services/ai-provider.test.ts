import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addFalImageInputs, buildPreservationPrompt, fitModelOutputImageSize, getProviderFor,
  normalizeResultToSourceDimensions,
} from './ai-provider';
import sharp from 'sharp';

test('selected fal model is used verbatim', () => {
  const provider = getProviderFor('fal', 'fal-ai/foo/edit');
  assert.equal(provider.name, 'fal');
  assert.equal(provider.modelId, 'fal-ai/foo/edit');
});

test('edit prompt requires a minimal localized change and preserves framing', () => {
  const prompt = buildPreservationPrompt('add people walking on the road');
  assert.match(prompt, /minimal, localized edit/i);
  assert.match(prompt, /Do not zoom, crop/i);
  assert.match(prompt, /leave all other pixels visually identical/i);
  assert.match(prompt, /EDIT REQUEST: add people walking on the road$/);
});

test('multi-image endpoints receive source first and references afterward', () => {
  const body: Record<string, unknown> = {};
  addFalImageInputs(body, ['prompt', 'image_urls'], 'source-data-uri', ['reference-1', 'reference-2']);
  assert.deepEqual(body.image_urls, ['source-data-uri', 'reference-1', 'reference-2']);
  assert.equal(body.image_url, undefined);
});

test('single-image endpoints never receive extra references', () => {
  const body: Record<string, unknown> = {};
  addFalImageInputs(body, ['prompt', 'image_url'], 'source-data-uri', ['reference-1']);
  assert.equal(body.image_url, 'source-data-uri');
  assert.equal(body.image_urls, undefined);
});

const MODEL_MIN_PIXELS = 655_360;
const MODEL_MAX_PIXELS = 3840 * 2160;

function assertValidModelSize(size: { width: number; height: number }) {
  assert.equal(size.width % 16, 0, 'width must be a multiple of 16');
  assert.equal(size.height % 16, 0, 'height must be a multiple of 16');
  assert.ok(size.width <= 3840 && size.height <= 3840, 'long edge must stay within 3840px');
  assert.ok(size.width * size.height >= MODEL_MIN_PIXELS, 'pixel count must reach the model minimum');
  assert.ok(size.width * size.height <= MODEL_MAX_PIXELS, 'pixel count must stay within the model maximum');
  assert.ok(Math.max(size.width / size.height, size.height / size.width) <= 3, 'aspect ratio must stay within 3:1');
}

test('crop sizes are rounded to the 16px grid fal accepts', () => {
  const size = fitModelOutputImageSize(2667, 2000);
  assertValidModelSize(size);
  const sourceRatio = 2667 / 2000;
  assert.ok(Math.abs(size.width / size.height - sourceRatio) / sourceRatio < 0.01);
});

test('a 1000x700 crop keeps its aspect ratio on the 16px grid', () => {
  const size = fitModelOutputImageSize(1000, 700);
  assertValidModelSize(size);
  assert.deepEqual(size, { width: 1008, height: 704 });
});

test('small crops are upscaled to the model minimum pixel count', () => {
  const size = fitModelOutputImageSize(400, 300);
  assertValidModelSize(size);
  const sourceRatio = 400 / 300;
  assert.ok(Math.abs(size.width / size.height - sourceRatio) / sourceRatio < 0.02);
});

test('crops wider than the 3:1 model limit are clamped into range', () => {
  const size = fitModelOutputImageSize(5000, 800);
  assertValidModelSize(size);
});

test('large crops are capped proportionally within every model limit', () => {
  const size = fitModelOutputImageSize(5334, 4000);
  assertValidModelSize(size);
  const sourceRatio = 5334 / 4000;
  assert.ok(Math.abs(size.width / size.height - sourceRatio) / sourceRatio < 0.01);
});

test('extreme panorama crops stay inside the cap', () => {
  const size = fitModelOutputImageSize(16000, 8000);
  assertValidModelSize(size);
  assert.ok(Math.abs(size.width / size.height - 2) / 2 < 0.01);
});

test('AI result is normalized to the exact source dimensions without cropping', async () => {
  const source = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: '#ffffff' },
  }).png().toBuffer();
  const result = await sharp({
    create: { width: 1024, height: 576, channels: 3, background: '#000000' },
  }).jpeg().toBuffer();

  const normalized = await normalizeResultToSourceDimensions(source, result);
  const metadata = await sharp(normalized).metadata();

  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 600);
  assert.equal(metadata.format, 'png');
});

