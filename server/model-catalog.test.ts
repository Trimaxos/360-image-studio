import test from 'node:test';
import assert from 'node:assert/strict';
import { chatgptOptions, classifyFalModel, getModelCatalog, ninerouterOptions } from './model-catalog';
import { config } from './config';

test('fal image edit and inpainting models remain in catalog', () => {
  const item = classifyFalModel({
    endpoint_id: 'fal-ai/editor',
    metadata: { display_name: 'Editor', categories: ['image-to-image', 'inpainting'] },
    openapi: { components: { schemas: { Input: { required: ['image_url', 'mask_url', 'prompt'] } } } },
  });
  assert.equal(item?.id, 'fal-ai/editor');
  assert.equal(item?.enabled, true);
  assert.equal(item?.supportsReferenceImages, false);
});

test('models accepting image_urls expose reference-image support', () => {
  const item = classifyFalModel({
    endpoint_id: 'fal-ai/multi-editor',
    metadata: { categories: ['image-to-image'] },
    openapi: { components: { schemas: { Input: { required: ['image_urls', 'prompt'], properties: {
      image_urls: { type: 'array' }, prompt: { type: 'string' },
    } } } } },
  });
  assert.equal(item?.supportsReferenceImages, true);
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

function editSchemaWithImageSize(imageSize: Record<string, unknown>) {
  return {
    openapi: {
      components: {
        schemas: {
          Input: {
            required: ['prompt', 'image_urls'],
            properties: {
              prompt: { type: 'string' },
              image_urls: { type: 'array' },
              image_size: imageSize,
            },
          },
          ImageSize: {
            type: 'object',
            properties: { width: { type: 'integer' }, height: { type: 'integer' } },
          },
        },
      },
    },
  };
}

test('allowlisted model with object image_size supports custom output size', () => {
  const item = classifyFalModel({
    endpoint_id: 'openai/gpt-image-2.5/flare/edit',
    metadata: { categories: ['image-to-image'] },
    ...editSchemaWithImageSize({
      anyOf: [{ $ref: '#/components/schemas/ImageSize' }, { type: 'string', enum: ['auto'] }],
    }),
  });
  assert.equal(item?.supportsCustomImageSize, true);
});

test('non-allowlisted endpoint does not enable custom output size', () => {
  const item = classifyFalModel({
    endpoint_id: 'fal-ai/other/edit',
    metadata: { categories: ['image-to-image'] },
    ...editSchemaWithImageSize({
      anyOf: [{ $ref: '#/components/schemas/ImageSize' }, { type: 'string', enum: ['auto'] }],
    }),
  });
  assert.equal(item?.supportsCustomImageSize, false);
});

test('enum-only image_size does not enable custom output size', () => {
  const item = classifyFalModel({
    endpoint_id: 'openai/gpt-image-2.5/flare/edit',
    metadata: { categories: ['image-to-image'] },
    ...editSchemaWithImageSize({ type: 'string', enum: ['auto', '1024x1024'] }),
  });
  assert.equal(item?.supportsCustomImageSize, false);
});

test('text to image model is omitted', () => {
  const item = classifyFalModel({
    endpoint_id: 'fal-ai/text',
    metadata: { categories: ['text-to-image'] },
  });
  assert.equal(item, null);
});


test('9router offers only Astra at high quality, even without a key (Generate asks for it)', (t) => {
  const old = config.ninerouterKey;
  t.after(() => { config.ninerouterKey = old; });
  config.ninerouterKey = '';
  const models = ninerouterOptions();
  assert.deepEqual(models.map((m) => m.id), ['cx/gpt-6-astra']);
  const [astra] = models;
  assert.equal(astra.extraParams?.quality, 'high');
  assert.equal(astra.provider, 'ninerouter');
  assert.equal(astra.enabled, true);
  assert.equal(astra.hasMask, false);
  assert.equal(astra.supportsReferenceImages, false);
  assert.ok(astra.capabilities.includes('image-edit'));
});

test('ChatGPT offers one image model, which needs no key (the Codex CLI login is checked on Generate)', () => {
  const models = chatgptOptions();
  assert.deepEqual(models.map((m) => m.id), ['gpt-image-2']);
  const [model] = models;
  assert.equal(model.provider, 'chatgpt');
  assert.equal(model.enabled, true);
  assert.equal(model.hasMask, false);
  assert.equal(model.supportsReferenceImages, false);
  assert.ok(model.capabilities.includes('image-edit'));
});

test('catalog lists every service (the prompt bar shows the one chosen in Settings) and fal only offers Flare Medium', async (t) => {
  const old = config.ninerouterKey;
  t.after(() => { config.ninerouterKey = old; });
  config.ninerouterKey = 'nr-key';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ models: [{
    endpoint_id: 'openai/gpt-image-2.5/flare/edit',
    metadata: { display_name: 'GPT Image 2.5 Flare Edit', categories: ['image-to-image'] },
    ...editSchemaWithImageSize({ type: 'string', enum: ['auto'] }),
  }] }));
  const { groups } = await getModelCatalog();
  assert.deepEqual(groups.map((group) => group.provider), ['chatgpt', 'ninerouter', 'fal']);
  assert.deepEqual(groups[0].models.map((m) => m.id), ['gpt-image-2']);
  assert.deepEqual(groups[1].models.map((m) => m.id), ['cx/gpt-6-astra']);
  const fal = groups.find((group) => group.provider === 'fal');
  assert.deepEqual(fal?.models.map((m) => m.id), ['openai/gpt-image-2.5/flare/edit::medium']);
  assert.equal(fal?.models[0].endpointId, 'openai/gpt-image-2.5/flare/edit');
  assert.equal(fal?.models[0].extraParams?.quality, 'medium');
});
