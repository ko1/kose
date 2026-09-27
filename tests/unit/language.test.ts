import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../../src/domain/language';

describe('detectLanguage', () => {
  it.each([
    ['We finally had went back to home.', 'en'],
    ["Koichi Sasada is a programmer. See a summary page of his activities (in Japanese).", 'en'],
    ['昨日は疲れてたので、すぐに寝ました。', 'ja'],
    ['このAPIは非同期で動くので、awaitを付けないと値が取れないです。', 'ja'],
    ['詳しくは https://example.com/docs/getting-started を見てください。', 'ja'],
    ['This PR fixes 設定ファイルの読み込み when the cache is invalidated by config changes.', 'mixed'],
    ['12345 !!!', 'unknown'],
  ])('%s → %s', (text, lang) => {
    expect(detectLanguage(text)).toBe(lang);
  });
});
