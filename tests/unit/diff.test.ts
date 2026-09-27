import { describe, expect, it } from 'vitest';
import { diffTexts, tokenize } from '../../src/domain/diff';

describe('tokenize', () => {
  it('英単語はまとめ、日本語は1文字ずつに分ける', () => {
    expect(tokenize('We went home.')).toEqual(['We', ' ', 'went', ' ', 'home', '.']);
    expect(tokenize('家に帰った')).toEqual(['家', 'に', '帰', 'っ', 'た']);
  });
});

describe('diffTexts', () => {
  it('英文の単語単位の差分', () => {
    const diff = diffTexts('We finally had went back to home.', 'We finally went back home.');
    const text = (type: string) => diff!.filter((s) => s.type === type).map((s) => s.text.trim());
    expect(text('delete')).toEqual(['had', 'to']);
    expect(text('insert')).toEqual([]);
    // 差分を連結すると元の文と改稿文が復元できる
    expect(diff!.filter((s) => s.type !== 'insert').map((s) => s.text).join('')).toBe('We finally had went back to home.');
    expect(diff!.filter((s) => s.type !== 'delete').map((s) => s.text).join('')).toBe('We finally went back home.');
  });

  it('日本語の文字単位の差分', () => {
    const diff = diffTexts('昨日は家に帰りました', '昨日は自宅に帰りました');
    expect(diff).toEqual([
      { type: 'equal', text: '昨日は' },
      { type: 'delete', text: '家' },
      { type: 'insert', text: '自宅' },
      { type: 'equal', text: 'に帰りました' },
    ]);
  });

  it('長すぎる入力では差分を計算しない', () => {
    const long = 'あ'.repeat(3000);
    expect(diffTexts(long, long + 'い')).toBeNull();
  });
});
