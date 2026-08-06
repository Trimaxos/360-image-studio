import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreservationPrompt, getProviderFor, normalizeResultToSourceDimensions } from './ai-provider';
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

