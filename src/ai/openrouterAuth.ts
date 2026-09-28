import { M } from '../shared/messages';

/**
 * 「OpenRouter でログイン」（OAuth PKCE）。ユーザーが OpenRouter で許可すると、この拡張用の API キーが発行される。
 * 自前のサーバーも事前の登録も要らない。コールバックは chrome.identity の https://<拡張ID>.chromiumapp.org/。
 */
const AUTH_URL = 'https://openrouter.ai/auth';
const KEYS_URL = 'https://openrouter.ai/api/v1/auth/keys';

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function authorizeUrl(callbackUrl: string, challenge: string): string {
  const params = new URLSearchParams({
    callback_url: callbackUrl,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params}`;
}

/** 認可コードを API キーに交換する */
export async function exchangeCode(
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<string> {
  const res = await fetchImpl(KEYS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  const body = (await res.json().catch(() => ({}))) as { key?: string };
  if (!res.ok || !body.key) throw new Error(M.options.openrouterLoginFailed);
  return body.key;
}

/** ログイン画面を開き、許可されたら API キーを返す。閉じられたら例外 */
export async function loginWithOpenRouter(): Promise<string> {
  const { verifier, challenge } = await createPkce();
  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authorizeUrl(chrome.identity.getRedirectURL(), challenge),
    interactive: true,
  });
  const code = responseUrl ? new URL(responseUrl).searchParams.get('code') : null;
  if (!code) throw new Error(M.options.openrouterLoginFailed);
  return exchangeCode(code, verifier);
}
