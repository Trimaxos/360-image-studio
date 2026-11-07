// The ChatGPT login of the Codex CLI (`codex login` writes ~/.codex/auth.json). ChatGPT's image endpoint takes its
// access token; one that expired (or that the endpoint turned down) is renewed with the refresh token and written back
// to the same file, as Codex itself does, so the Codex CLI keeps working with the renewed login.
import fs from 'fs';
import { config } from '../config';

export interface ChatGptCredentials { accessToken: string; accountId: string }

const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const RENEW_BEFORE_MS = 5 * 60 * 1000;
const NOT_SIGNED_IN = 'Máy này chưa đăng nhập Codex CLI nên chưa dùng được model ChatGPT. Cài Codex CLI rồi chạy `codex login`.';
const SIGN_IN_AGAIN = 'Đăng nhập ChatGPT của Codex CLI đã hết hạn. Chạy `codex login` lại trên máy này.';

function readAuth(): any {
  let auth: any;
  try {
    auth = JSON.parse(fs.readFileSync(config.codexAuthFile, 'utf8'));
  } catch {
    throw new Error(NOT_SIGNED_IN);
  }
  if (!auth?.tokens?.access_token || !auth.tokens.account_id) throw new Error(NOT_SIGNED_IN);
  return auth;
}

/** This computer has a Codex CLI login; an expired one counts too, it is renewed on Generate. */
export function chatgptSignedIn(): boolean {
  try {
    readAuth();
    return true;
  } catch {
    return false;
  }
}

function expiresAt(jwt: string): number {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).exp * 1000;
  } catch {
    return 0;
  }
}

// The refresh token is single use: generations that find the token expired at the same time share one renewal.
let renewal: Promise<ChatGptCredentials> | null = null;

async function renew(): Promise<ChatGptCredentials> {
  const auth = readAuth();
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: auth.tokens.refresh_token, scope: 'openid profile email',
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = response.ok ? await response.json() as any : null;
  if (!data?.access_token) throw new Error(SIGN_IN_AGAIN);
  auth.tokens = {
    ...auth.tokens,
    access_token: data.access_token,
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
    ...(data.id_token ? { id_token: data.id_token } : {}),
  };
  auth.last_refresh = new Date().toISOString();
  await fs.promises.writeFile(config.codexAuthFile, JSON.stringify(auth, null, 2));
  return { accessToken: auth.tokens.access_token, accountId: auth.tokens.account_id };
}

/** The login to send to ChatGPT; `turnedDown` renews it even if it has not expired yet. */
export async function chatgptCredentials(turnedDown = false): Promise<ChatGptCredentials> {
  if (renewal) return renewal;
  const { tokens } = readAuth();
  if (!turnedDown && expiresAt(tokens.access_token) - Date.now() > RENEW_BEFORE_MS) {
    return { accessToken: tokens.access_token, accountId: tokens.account_id };
  }
  renewal = renew().finally(() => { renewal = null; });
  return renewal;
}
