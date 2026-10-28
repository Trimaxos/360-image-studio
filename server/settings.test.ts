import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import cors from 'cors';
import express from 'express';
import { config } from './config';
import { applySavedSettings, saveSettings, settingsStatus } from './settings';
import { settingsRouter } from './routes/settings';

const original = { ...config };
let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-'));
  config.settingsFile = path.join(dir, 'nested', 'settings.json');
  config.ninerouterBaseUrl = 'http://env-gateway:20128/v1';
  config.ninerouterKey = 'env-ninerouter-key';
  config.falAiKey = '';
});

afterEach(async () => {
  Object.assign(config, original);
  await fs.rm(dir, { recursive: true, force: true });
});

test('saved settings are used at once and again after a restart, over the .env values', async () => {
  await saveSettings({ ninerouterBaseUrl: 'http://saved-gateway:1/v1', falAiKey: 'fal-saved-key-1234' });
  assert.equal(config.ninerouterBaseUrl, 'http://saved-gateway:1/v1');
  assert.equal(config.falAiKey, 'fal-saved-key-1234');

  // A restart: the process starts again from the .env values, then reads the saved file.
  Object.assign(config, { ninerouterBaseUrl: 'http://env-gateway:20128/v1', ninerouterKey: 'env-ninerouter-key', falAiKey: '' });
  applySavedSettings();
  assert.equal(config.ninerouterBaseUrl, 'http://saved-gateway:1/v1');
  assert.equal(config.falAiKey, 'fal-saved-key-1234');
  assert.equal(config.ninerouterKey, 'env-ninerouter-key', 'a field never saved keeps its .env value');
});

test('no saved file leaves the .env values as they are', () => {
  applySavedSettings();
  assert.equal(config.ninerouterBaseUrl, 'http://env-gateway:20128/v1');
  assert.equal(config.ninerouterKey, 'env-ninerouter-key');
});

test('the status shows only the end of each key, never the key itself', async () => {
  await saveSettings({ ninerouterKey: 'sk-secret-9router-abcd' });
  const status = settingsStatus();
  assert.deepEqual(status, { ninerouterBaseUrl: 'http://env-gateway:20128/v1', ninerouterKey: '…abcd', falAiKey: null });
  assert.doesNotMatch(JSON.stringify(status), /secret/);
});

test('an empty key field keeps the key already there', async () => {
  await saveSettings({ ninerouterKey: '   ', falAiKey: '' });
  assert.equal(config.ninerouterKey, 'env-ninerouter-key');
  assert.equal(config.falAiKey, '');
});

test('a URL that is not http(s) is refused and nothing is saved', async () => {
  await assert.rejects(saveSettings({ ninerouterBaseUrl: 'localhost:20128' }), /URL 9router không hợp lệ/);
  assert.equal(config.ninerouterBaseUrl, 'http://env-gateway:20128/v1');
  await assert.rejects(fs.access(config.settingsFile));
});

test('only the app itself may change the settings, not another web page', async (t) => {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/settings', settingsRouter);
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const put = (origin?: string) => fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ ninerouterBaseUrl: 'https://evil.example/v1' }),
  });

  const foreign = await put('https://evil.example');
  assert.equal(foreign.status, 403);
  assert.equal(config.ninerouterBaseUrl, 'http://env-gateway:20128/v1');

  const own = await put(base);
  assert.equal(own.status, 200);
  assert.equal((await own.json()).ninerouterBaseUrl, 'https://evil.example/v1');

  const bad = await fetch(`${base}/api/settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ninerouterBaseUrl: 'nope' }),
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /URL 9router không hợp lệ/);

  const status = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(status.ninerouterKey, '…-key');
});
