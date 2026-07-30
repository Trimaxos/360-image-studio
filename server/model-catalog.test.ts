import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFalModel, isLocalRuntimeReady, localArtifactComplete } from './model-catalog';

test('fal image edit and inpainting models remain in catalog', () => {
  const item = classifyFalModel({
    endpoint_id: 'fal-ai/editor',
    metadata: { display_name: 'Editor', categories: ['image-to-image', 'inpainting'] },
    openapi: { components: { schemas: { Input: { required: ['image_url', 'mask_url', 'prompt'] } } } },
  });
  assert.equal(item?.id, 'fal-ai/editor');
  assert.equal(item?.enabled, true);
});

test('fal model with unsupported required input stays disabled', () => {
  const item = classifyFalModel({
    endpoint_id: 'fal-ai/control-editor',
    metadata: { categories: ['inpainting'] },
    openapi: { components: { schemas: { Input: { required: ['image_url', 'mask_url', 'prompt', 'controlnet'] } } } },
  });
  assert.equal(item?.enabled, false);
  assert.match(item?.disabledReason ?? '', /controlnet/);
});

test('text to image model is omitted', () => {
  const item = classifyFalModel({
    endpoint_id: 'fal-ai/text',
    metadata: { categories: ['text-to-image'] },
  });
  assert.equal(item, null);
});

test('partial local model download is not considered ready', () => {
  assert.equal(localArtifactComplete(1_000_000_000), false);
  assert.equal(localArtifactComplete(6_500_000_000), true);
});

test('local runtime is enabled only after the model is loaded', () => {
  assert.equal(isLocalRuntimeReady({ status: 'ready', modelLoaded: true }), true);
  assert.equal(isLocalRuntimeReady({ status: 'loading', modelLoaded: false }), false);
  assert.equal(isLocalRuntimeReady({ status: 'error', modelLoaded: false }), false);
});
