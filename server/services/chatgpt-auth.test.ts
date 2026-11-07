import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config';
import { chatgptCredentials } from './chatgpt-auth';

/** A JWT whose payload only carries `exp`, enough for the expiry check. */
function jwt(expiresInSeconds: number) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString('base64url');
  return `header.${payload}.signature`;
}

function useAuthFile(t: test.TestContext, tokens: Record<string, string> | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-auth-'));
  const old = config.codexAuthFile;
  config.codexAuthFile = path.join(dir, 'auth.json');
  t.after(() => { config.codexAuthFile = old; fs.rmSync(dir, { recursive: true, force: true }); });
  if (tokens) {
    fs.writeFileSync(config.codexAuthFile, JSON.stringify({
      auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens, last_refresh: '2026-11-01T00:00:00Z',
    }, null, 2));
  }
  return config.codexAuthFile;
}

test('a valid Codex CLI login gives its access token and account without refreshing', async (t) => {
  const access = jwt(3600);
  useAuthFile(t, { id_token: 'id', access_token: access, refresh_token: 'rt-1', account_id: 'acct-1' });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('no refresh expected'); });
  assert.deepEqual(await chatgptCredentials(), { accessToken: access, accountId: 'acct-1' });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('without a Codex CLI login the error says to run codex login', async (t) => {
  useAuthFile(t, null);
  await assert.rejects(chatgptCredentials(), /chưa đăng nhập Codex CLI.*codex login/i);
});

test('an expired access token is refreshed once and written back for Codex CLI too', async (t) => {
  const file = useAuthFile(t, { id_token: 'id-old', access_token: jwt(-60), refresh_token: 'rt-old', account_id: 'acct-1' });
  const fresh = jwt(10 * 86400);
  const calls: Array<{ url: string; body: any }> = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(options?.body as string) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ access_token: fresh, refresh_token: 'rt-new', id_token: 'id-new' });
  });
  // Two generations at once must not both spend the refresh token: it is single use.
  const [first, second] = await Promise.all([chatgptCredentials(), chatgptCredentials()]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://auth.openai.com/oauth/token');
  assert.deepEqual(calls[0].body, {
    client_id: 'app_EMoamEEZ73f0CkXaXp7hrann', grant_type: 'refresh_token', refresh_token: 'rt-old', scope: 'openid profile email',
  });
  assert.deepEqual(first, { accessToken: fresh, accountId: 'acct-1' });
  assert.deepEqual(second, first);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.tokens, { id_token: 'id-new', access_token: fresh, refresh_token: 'rt-new', account_id: 'acct-1' });
  assert.equal(saved.auth_mode, 'chatgpt');
  assert.ok(Date.now() - Date.parse(saved.last_refresh) < 60_000);
});

test('a token the server turned down is refreshed even before it expires', async (t) => {
  useAuthFile(t, { id_token: 'id', access_token: jwt(3600), refresh_token: 'rt-1', account_id: 'acct-1' });
  const fresh = jwt(10 * 86400);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ access_token: fresh, refresh_token: 'rt-2' }));
  assert.equal((await chatgptCredentials(true)).accessToken, fresh);
});

test('a refresh that fails says to sign in to Codex CLI again', async (t) => {
  useAuthFile(t, { id_token: 'id', access_token: jwt(-60), refresh_token: 'rt-used', account_id: 'acct-1' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'refresh_token_reused' }, { status: 401 }));
  await assert.rejects(chatgptCredentials(), /hết hạn.*codex login/i);
});
