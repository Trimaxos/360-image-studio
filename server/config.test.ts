import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl } from './config';

test('normalizes the Local AI base URL for OCI endpoints', () => {
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8765/'), 'http://127.0.0.1:8765');
  assert.equal(normalizeBaseUrl(' http://local-ai:8765/// '), 'http://local-ai:8765');
});
