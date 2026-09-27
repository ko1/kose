import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from '../../src/storage/settings';
import { fakeChrome } from '../fakeChrome';

describe('settings', () => {
  it('既定値: Chrome内蔵AI、よい英語、日常会話・SNS', () => {
    expect(DEFAULT_SETTINGS.provider).toBe('builtin');
    expect(DEFAULT_SETTINGS.targetLanguage).toBe('en');
    expect(DEFAULT_SETTINGS.situation).toBe('casual');
    expect(DEFAULT_SETTINGS.openaiApiKey).toBe('');
  });

  it('壊れた値は項目ごとに既定値で補う', () => {
    const s = normalizeSettings({ situation: 'technical', targetLanguage: 'fr', openaiMaxInputChars: -1 });
    expect(s.situation).toBe('technical');
    expect(s.targetLanguage).toBe('en');
    expect(s.openaiMaxInputChars).toBe(4000);
    expect(normalizeSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });

  it('chrome.storage.local に保存され、再読み込みで復元される', async () => {
    await saveSettings({ targetLanguage: 'ja', situation: 'business' });
    await saveSettings({ provider: 'openai' });
    expect(fakeChrome().storage.local.data.settings).toMatchObject({ targetLanguage: 'ja', provider: 'openai' });
    const loaded = await loadSettings();
    expect(loaded).toMatchObject({ targetLanguage: 'ja', situation: 'business', provider: 'openai' });
  });

  it('続けて保存しても前の変更を失わない（ページをまたいで直列化する）', async () => {
    await Promise.all([saveSettings({ targetLanguage: 'ja' }), saveSettings({ situation: 'technical' })]);
    expect(await loadSettings()).toMatchObject({ targetLanguage: 'ja', situation: 'technical' });
  });
});
