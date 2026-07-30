import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderFor } from './ai-provider';

test('selected fal model is used verbatim', () => {
  const provider = getProviderFor('fal', 'fal-ai/foo/edit');
  assert.equal(provider.name, 'fal');
  assert.equal(provider.modelId, 'fal-ai/foo/edit');
});

test('unknown local model is rejected', () => {
  assert.throws(() => getProviderFor('local', 'local/unknown'), /not configured/);
});
