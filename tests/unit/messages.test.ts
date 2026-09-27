import { describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../fakeChrome';

async function catalogFor(uiLanguage: string) {
  fakeChrome().i18n.uiLanguage = uiLanguage;
  vi.resetModules();
  return (await import('../../src/shared/messages')).M;
}

describe('message catalogs', () => {
  it('uses Japanese when the browser UI language is Japanese, English otherwise', async () => {
    expect((await catalogFor('ja')).settingsBar.apply).toBe('変更');
    expect((await catalogFor('ja-JP')).menu.invokeTitle('よい英語')).toBe('kose: よい英語にする');
    expect((await catalogFor('en-US')).settingsBar.apply).toBe('Apply');
    expect((await catalogFor('fr')).menu.invokeTitle('good English')).toBe('kose: Make it good English');
  });

  it('uiLanguage returns the primary subtag', async () => {
    const { uiLanguage } = await import('../../src/shared/locale');
    fakeChrome().i18n.uiLanguage = 'ja-JP';
    expect(uiLanguage()).toBe('ja');
    fakeChrome().i18n.uiLanguage = 'en_US';
    expect(uiLanguage()).toBe('en');
  });
});
