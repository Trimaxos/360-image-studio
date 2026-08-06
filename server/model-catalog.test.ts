import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFalModel } from './model-catalog';

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

