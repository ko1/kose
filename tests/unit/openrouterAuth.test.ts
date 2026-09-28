import { describe, expect, it, vi } from 'vitest';
import { authorizeUrl, createPkce, exchangeCode } from '../../src/ai/openrouterAuth';

describe('OpenRouter OAuth PKCE', () => {
  it('verifier の SHA-256 を base64url にしたものを challenge にする', async () => {
    const { verifier, challenge } = await createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    expect(challenge).toBe(Buffer.from(digest).toString('base64url'));
  });

  it('認可画面の URL にコールバックと challenge を載せる', () => {
    const url = new URL(authorizeUrl('https://abc.chromiumapp.org/', 'CH'));
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      callback_url: 'https://abc.chromiumapp.org/',
      code_challenge: 'CH',
      code_challenge_method: 'S256',
    });
  });

  it('認可コードを API キーに交換する。失敗したら例外', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ key: 'sk-or-v1-abc' }), { status: 200 }));
    expect(await exchangeCode('CODE', 'VER', fetchImpl)).toBe('sk-or-v1-abc');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(JSON.parse(init.body as string)).toEqual({ code: 'CODE', code_verifier: 'VER', code_challenge_method: 'S256' });

    const bad = vi.fn(async () => new Response('{}', { status: 403 }));
    await expect(exchangeCode('CODE', 'VER', bad)).rejects.toThrow(/Could not log in/);
  });
});
