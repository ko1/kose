import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/domain/srs';
import {
  clearMistakes,
  deleteMistake,
  exportMistakes,
  importMistakes,
  loadMistakes,
  onMistakesChanged,
  rateMistake,
  saveMistakes,
} from '../../src/storage/mistakeStore';
import { fakeChrome } from '../fakeChrome';

const T0 = Date.UTC(2026, 0, 1);
const cand = (before: string, after: string) => ({ language: 'en' as const, before, after, explanationJa: '説明' });

describe('mistakeStore', () => {
  it('保存・評価・削除・全削除ができ、同時に呼んでも取りこぼさない', async () => {
    await Promise.all([saveMistakes([cand('a', 'b')], T0), saveMistakes([cand('c', 'd')], T0)]);
    let cards = await loadMistakes();
    expect(cards.map((c) => c.before).sort()).toEqual(['a', 'c']);

    await rateMistake(cards[0].id, 'good', T0 + DAY_MS);
    cards = await loadMistakes();
    expect(cards[0].review).toMatchObject({ repetitions: 1, lastReviewedAt: T0 + DAY_MS });

    await deleteMistake(cards[0].id);
    expect(await loadMistakes()).toHaveLength(1);
    await clearMistakes();
    expect(await loadMistakes()).toEqual([]);
  });

  it('原文全体やURLは保存しない（語句と解説だけ）', async () => {
    await saveMistakes([cand('had went', 'went')], T0);
    const stored = fakeChrome().storage.local.data.mistakes as Record<string, unknown>[];
    expect(Object.keys(stored[0]).sort()).toEqual(
      ['id', 'key', 'language', 'before', 'after', 'explanationJa', 'createdAt', 'lastSeenAt', 'count', 'review'].sort(),
    );
  });

  it('壊れた項目は読み飛ばす', async () => {
    await saveMistakes([cand('a', 'b')], T0);
    const c = fakeChrome();
    (c.storage.local.data.mistakes as unknown[]).push({ id: 'broken' }, 'x');
    expect(await loadMistakes()).toHaveLength(1);
  });

  it('変更を通知する（設定画面とkoseウィンドウの同期）', async () => {
    const seen: number[] = [];
    const off = onMistakesChanged((cards) => seen.push(cards.length));
    await saveMistakes([cand('a', 'b')], T0);
    await clearMistakes();
    off();
    await saveMistakes([cand('a', 'b')], T0);
    expect(seen).toEqual([1, 0]);
  });

  it('書き出したJSONを読み込むと、既にある間違いは飛ばして追加する', async () => {
    await saveMistakes([cand('a', 'b'), cand('c', 'd')], T0);
    const json = exportMistakes(await loadMistakes(), T0);
    await clearMistakes();
    await saveMistakes([cand('A', 'b')], T0);
    expect(await importMistakes(json)).toBe(1);
    expect((await loadMistakes()).map((c) => c.before).sort()).toEqual(['A', 'c']);
    await expect(importMistakes('{"cards": []}')).rejects.toThrow('書き出しファイルではありません');
    await expect(importMistakes('not json')).rejects.toThrow();
  });
});
