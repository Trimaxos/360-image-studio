import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addFalImageInputs, buildPreservationPrompt, fitModelOutputImageSize, getProviderFor,
  normalizeResultToSourceDimensions, pickGptImageSize, resizeRequestInputs,
} from './ai-provider';
import sharp from 'sharp';
import { config } from '../config';

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
  // Existing layers are never recropped at Generate: preserve their exact
  // ratio even when their native dimensions are not multiples of 16.
  assert.deepEqual(size, { width: 1120, height: 784 });
  assert.equal(size.width * 700, size.height * 1000);
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

// Regression: sending an input image whose size differs from the requested
// output size made the model reframe the content on its own canvas, so the
// result came back visibly shifted (~4% on a 400x300 crop) once normalized to
// the source. Input image and mask must match the model's output canvas.
test('request image and mask are resized to the model output size', async () => {
  const base = await sharp({
    create: { width: 400, height: 300, channels: 3, background: '#808080' },
  }).png().toBuffer();
  const marker = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#ff0000' },
  }).png().toBuffer();
  const image = await sharp(base)
    .composite([{ input: marker, left: 100, top: 100 }])
    .png()
    .toBuffer();
  const mask = await sharp({
    create: { width: 400, height: 300, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).png().toBuffer();

  const prepared = await resizeRequestInputs(
    image.toString('base64'),
    mask.toString('base64'),
    960,
    720,
  );

  const imageMeta = await sharp(Buffer.from(prepared.base64Image, 'base64')).metadata();
  const maskMeta = await sharp(Buffer.from(prepared.base64Mask, 'base64')).metadata();
  assert.equal(imageMeta.width, 960);
  assert.equal(imageMeta.height, 720);
  assert.equal(maskMeta.width, 960);
  assert.equal(maskMeta.height, 720);

  const { data, info } = await sharp(Buffer.from(prepared.base64Image, 'base64'))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) =>
    Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
  assert.deepEqual(pixel(288, 276), [255, 0, 0], 'marker keeps its relative position');
  assert.deepEqual(pixel(20, 20), [128, 128, 128], 'background is preserved');
});

test('request inputs already at the model size are left untouched', async () => {
  const image = await sharp({
    create: { width: 400, height: 300, channels: 3, background: '#808080' },
  }).png().toBuffer();
  const mask = await sharp({
    create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();

  const prepared = await resizeRequestInputs(
    image.toString('base64'),
    mask.toString('base64'),
    400,
    300,
  );

  assert.equal(prepared.base64Image, image.toString('base64'));
  assert.equal(prepared.base64Mask, mask.toString('base64'));
});

test('aligned crops keep the exact aspect ratio when upscaled for AI', () => {
  const size = fitModelOutputImageSize(400, 288);
  assertValidModelSize(size);
  assert.equal(size.width * 288, size.height * 400);
});

test('provider honors the canvas paired with a native crop off the 16px grid', () => {
  assert.deepEqual(fitModelOutputImageSize(952, 532), { width: 1088, height: 608 });
});

test('mask dimensions are checked even when source dimensions already match', async () => {
  const image = await sharp({ create: { width: 960, height: 720, channels: 3, background: '#888' } }).png().toBuffer();
  const mask = await sharp({ create: { width: 400, height: 300, channels: 4, background: '#fff' } }).png().toBuffer();
  const prepared = await resizeRequestInputs(image.toString('base64'), mask.toString('base64'), 960, 720);
  const meta = await sharp(Buffer.from(prepared.base64Mask, 'base64')).metadata();
  assert.equal(meta.width, 960);
  assert.equal(meta.height, 720);
});

test('provider sends matching image/mask/canvas and rejects unexpected output dimensions', async (t) => {
  const oldKey = config.falAiKey;
  config.falAiKey = 'test-key';
  t.after(() => { config.falAiKey = oldKey; });
  const source = await sharp({ create: { width: 400, height: 288, channels: 3, background: '#888' } }).png().toBuffer();
  const mask = await sharp({ create: { width: 400, height: 288, channels: 4, background: '#fff' } }).png().toBuffer();
  let wrongOutput = false;
  const size = { width: 1200, height: 864 };
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(options.body as string);
      assert.deepEqual(body.image_size, size);
      for (const uri of [body.image_urls[0], body.mask_url]) {
        assert.match(uri, /^data:image\/png;base64,/);
        const meta = await sharp(Buffer.from(uri.split(',')[1], 'base64')).metadata();
        assert.equal(meta.width, size.width);
        assert.equal(meta.height, size.height);
      }
      return Response.json({ images: [{ url: 'https://test.invalid/result.png' }] });
    }
    const image = await sharp({ create: { width: wrongOutput ? 992 : size.width,
      height: size.height, channels: 3, background: '#888' } }).png().toBuffer();
    return new Response(new Uint8Array(image));
  });
  const provider = getProviderFor('fal', 'test-model', ['image_urls', 'mask_url', 'image_size'],
    undefined, undefined, true, true, true);
  const result = await provider.edit(source.toString('base64'), mask.toString('base64'), 'edit center');
  const meta = await sharp(Buffer.from(result.base64Result, 'base64')).metadata();
  assert.equal(meta.width, 400);
  assert.equal(meta.height, 288);
  wrongOutput = true;
  await assert.rejects(provider.edit(source.toString('base64'), mask.toString('base64'), 'edit center'), /kích thước/);
});


async function solidPng(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#888' } }).png().toBuffer();
}

test('ninerouter provider asks /responses for an image and resizes it to the source crop', async (t) => {
  const old = { key: config.ninerouterKey, url: config.ninerouterBaseUrl };
  config.ninerouterKey = 'nr-key';
  config.ninerouterBaseUrl = 'http://gateway.invalid/v1/';
  t.after(() => { config.ninerouterKey = old.key; config.ninerouterBaseUrl = old.url; });
  const source = await solidPng(400, 400);
  const generated = await solidPng(512, 512);
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
    calls.push({ url: String(url), headers: options?.headers as Record<string, string>, body: JSON.parse(options?.body as string) });
    return Response.json({ output: [
      { type: 'reasoning' },
      { type: 'image_generation_call', status: 'completed', result: generated.toString('base64') },
    ] });
  });
  const provider = getProviderFor('ninerouter', 'cx/gpt-6-astra');
  assert.equal(provider.name, 'ninerouter');
  const result = await provider.edit(source.toString('base64'), '', 'make the sky blue');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://gateway.invalid/v1/responses');
  assert.equal(calls[0].headers.Authorization, 'Bearer nr-key');
  assert.equal(calls[0].body.model, 'cx/gpt-6-astra');
  assert.equal(calls[0].body.stream, false);
  assert.deepEqual(calls[0].body.tools, [{ type: 'image_generation' }]);
  const content = calls[0].body.input[0].content;
  assert.match(content[0].text, /EDIT REQUEST: make the sky blue/);
  assert.equal(content[1].type, 'input_image');
  assert.match(content[1].image_url, /^data:image\/png;base64,/);
  const meta = await sharp(Buffer.from(result.base64Result, 'base64')).metadata();
  assert.equal(meta.width, 400);
  assert.equal(meta.height, 400);
  assert.equal(result.model, 'cx/gpt-6-astra');
});

test('ninerouter provider rejects results whose aspect ratio drifted instead of stretching them', async (t) => {
  const old = config.ninerouterKey;
  config.ninerouterKey = 'nr-key';
  t.after(() => { config.ninerouterKey = old; });
  const source = await solidPng(400, 400);
  const generated = await solidPng(600, 400);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ output: [
    { type: 'image_generation_call', result: generated.toString('base64') },
  ] }));
  const provider = getProviderFor('ninerouter', 'cx/gpt-6-astra');
  await assert.rejects(provider.edit(source.toString('base64'), '', 'edit'), /tỉ lệ/);
});

test('ninerouter provider surfaces the assistant text when no image is returned', async (t) => {
  const old = config.ninerouterKey;
  config.ninerouterKey = 'nr-key';
  t.after(() => { config.ninerouterKey = old; });
  const source = await solidPng(400, 400);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ output: [
    { type: 'message', content: [{ type: 'output_text', text: 'no image-editing tool is available' }] },
  ] }));
  const provider = getProviderFor('ninerouter', 'cx/gpt-6-luna');
  await assert.rejects(provider.edit(source.toString('base64'), '', 'edit'), /no image-editing tool is available/);
});

test('ninerouter provider requires an API key and reports gateway errors', async (t) => {
  const old = config.ninerouterKey;
  const source = await solidPng(64, 64);
  config.ninerouterKey = '';
  t.after(() => { config.ninerouterKey = old; });
  const provider = getProviderFor('ninerouter', 'cx/gpt-6-astra');
  await assert.rejects(provider.edit(source.toString('base64'), '', 'edit'), /NINEROUTER_API_KEY/);
  config.ninerouterKey = 'nr-key';
  t.mock.method(globalThis, 'fetch', async () => new Response('quota exceeded', { status: 429 }));
  await assert.rejects(provider.edit(source.toString('base64'), '', 'edit'), /429.*quota exceeded/);
});

test('gpt-image size follows the crop aspect ratio', () => {
  assert.deepEqual(pickGptImageSize(1200, 800), { width: 1536, height: 1024 });
  assert.deepEqual(pickGptImageSize(800, 1200), { width: 1024, height: 1536 });
  assert.deepEqual(pickGptImageSize(1000, 1000), { width: 1024, height: 1024 });
  assert.deepEqual(pickGptImageSize(1100, 1000), { width: 1024, height: 1024 });
  assert.deepEqual(pickGptImageSize(3000, 1000), { width: 1536, height: 1024 });
});

test('ninerouter gpt-image model edits through /images/generations at a standard size', async (t) => {
  const old = { key: config.ninerouterKey, url: config.ninerouterBaseUrl };
  config.ninerouterKey = 'nr-key';
  config.ninerouterBaseUrl = 'http://gateway.invalid/v1/';
  t.after(() => { config.ninerouterKey = old.key; config.ninerouterBaseUrl = old.url; });
  const source = await solidPng(1200, 800);
  const generated = await solidPng(1536, 1024);
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
    calls.push({ url: String(url), headers: options?.headers as Record<string, string>, body: JSON.parse(options?.body as string) });
    return Response.json({ data: [{ b64_json: generated.toString('base64') }] });
  });
  const provider = getProviderFor('ninerouter', 'cx/gpt-image-2.5-flare', undefined, undefined, { quality: 'high' });
  const result = await provider.edit(source.toString('base64'), '', 'add a car');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://gateway.invalid/v1/images/generations');
  assert.equal(calls[0].headers.Authorization, 'Bearer nr-key');
  const { body } = calls[0];
  assert.equal(body.model, 'cx/gpt-image-2.5-flare');
  assert.equal(body.quality, 'high');
  assert.equal(body.size, '1536x1024');
  assert.equal(body.output_format, 'png');
  assert.equal(body.n, 1);
  assert.match(body.prompt, /EDIT REQUEST: add a car/);
  assert.match(body.image, /^data:image\/png;base64,/);
  const sent = await sharp(Buffer.from(body.image.split(',')[1], 'base64')).metadata();
  assert.equal(sent.width, 1536);
  assert.equal(sent.height, 1024);
  const meta = await sharp(Buffer.from(result.base64Result, 'base64')).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 800);
  assert.equal(result.model, 'cx/gpt-image-2.5-flare');
});

test('ninerouter gpt-image model defaults to high quality without extraParams', async (t) => {
  const old = config.ninerouterKey;
  config.ninerouterKey = 'nr-key';
  t.after(() => { config.ninerouterKey = old; });
  const source = await solidPng(400, 400);
  const generated = await solidPng(1024, 1024);
  let quality: unknown;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    quality = JSON.parse(options?.body as string).quality;
    return Response.json({ data: [{ b64_json: generated.toString('base64') }] });
  });
  await getProviderFor('ninerouter', 'cx/gpt-image-2.5-flare').edit(source.toString('base64'), '', 'edit');
  assert.equal(quality, 'high');
});

test('ninerouter gpt-image model accepts its own resolution when the aspect ratio matches', async (t) => {
  const old = config.ninerouterKey;
  config.ninerouterKey = 'nr-key';
  t.after(() => { config.ninerouterKey = old; });
  const source = await solidPng(876, 876);
  // Asked for 1024x1024, the gateway answers with its own square size.
  const generated = await solidPng(1254, 1254);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ b64_json: generated.toString('base64') }] }));
  const result = await getProviderFor('ninerouter', 'cx/gpt-image-2.5-flare').edit(source.toString('base64'), '', 'edit');
  const meta = await sharp(Buffer.from(result.base64Result, 'base64')).metadata();
  assert.deepEqual([meta.width, meta.height], [876, 876]);
});

test('ninerouter gpt-image model fails when no image or a wrong aspect ratio comes back', async (t) => {
  const old = config.ninerouterKey;
  config.ninerouterKey = 'nr-key';
  t.after(() => { config.ninerouterKey = old; });
  const source = await solidPng(1200, 800);
  const provider = getProviderFor('ninerouter', 'cx/gpt-image-2.5-flare');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [{}] }));
  await assert.rejects(provider.edit(source.toString('base64'), '', 'edit'), /9router không trả ảnh/);
  const wrong = await solidPng(1024, 1024);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [{ b64_json: wrong.toString('base64') }] }));
  await assert.rejects(provider.edit(source.toString('base64'), '', 'edit'), /sai tỉ lệ.*1024×1024.*1536×1024/);
  t.mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 500 }));
  await assert.rejects(provider.edit(source.toString('base64'), '', 'edit'), /9router error: 500 boom/);
});
