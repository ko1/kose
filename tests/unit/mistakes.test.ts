import { describe, expect, it } from 'vitest';
import { dueCards, extractMistakes, mergeMistakes, mistakeKey } from '../../src/domain/mistakes';
import { DAY_MS } from '../../src/domain/srs';
import type { Change, ResultVersion, ReviewSession } from '../../src/domain/types';

const T0 = Date.UTC(2026, 0, 1);
const ORIGINAL = 'We finally had went back to home.';
const REVISED = 'We finally went back home.';

const change = (before: string, after: string, type: Change['type'] = 'objective_error'): Change => ({
  before,
  after,
  type,
  explanation: `${before} → ${after}`,
});

function fixture(changes: Change[], opts: Partial<ResultVersion> = {}, session: Partial<ReviewSession> = {}) {
  const version: ResultVersion = {
    id: 'v1',
    result: { revisedText: REVISED, detectedSourceLanguage: 'en' },
    targetLanguage: 'en',
    situation: 'casual',
    origin: 'initial',
    createdAt: T0,
    explanation: { explanation: '', changes, nuanceWarnings: [], droppedChanges: 0 },
    ...opts,
  };
  const s: ReviewSession = {
    id: 's1',
    createdAt: T0,
    source: { tabId: 1, frameId: 0, textSource: 'script', editable: false },
    sourceText: ORIGINAL,
    sourceLanguage: 'en',
    versions: [version],
    currentVersionId: 'v1',
    messages: [],
    targetLanguage: 'en',
    situation: 'casual',
    status: { kind: 'idle' },
    ...session,
  };
  return { session: s, version };
}

describe('extractMistakes', () => {
  it('同じ言語の校正の客観的な誤りだけを取り出す', () => {
    const { session, version } = fixture([
      change('had went', 'went'),
      change('back to home', 'back home'),
      change('finally', 'at last', 'style'),
      change('We', 'We', 'uncertain'),
    ]);
    expect(extractMistakes(session, version)).toEqual([
      { language: 'en', before: 'had went', after: 'went', explanation: 'had went → went' },
      { language: 'en', before: 'back to home', after: 'back home', explanation: 'back to home → back home' },
    ]);
  });

  it('再生成・相談の案、翻訳、言語が混在・不明の原文からは記録しない', () => {
    const changes = [change('had went', 'went')];
    expect(extractMistakes(...args(fixture(changes, { origin: 'regenerate' })))).toEqual([]);
    expect(extractMistakes(...args(fixture(changes, { origin: 'chat' })))).toEqual([]);
    expect(extractMistakes(...args(fixture(changes, { targetLanguage: 'ja' })))).toEqual([]);
    expect(extractMistakes(...args(fixture(changes, {}, { sourceLanguage: 'mixed' })))).toEqual([]);
    expect(
      extractMistakes(...args(fixture(changes, { result: { revisedText: REVISED, detectedSourceLanguage: 'ja' } }))),
    ).toEqual([]);
    expect(extractMistakes(...args(fixture(changes, { explanation: undefined })))).toEqual([]);
  });

  it('原文・改稿文にない語句、空の語句、長すぎる語句、重複は除く', () => {
    const long = 'x'.repeat(41);
    const { session, version } = fixture(
      [change('have gone', 'went'), change('', 'the'), change('had went', 'went'), change('had went', 'went')],
      {},
      {},
    );
    expect(extractMistakes(session, version)).toHaveLength(1);
    const longFixture = fixture([change(long, 'went')], {}, { sourceText: `${long} back` });
    expect(extractMistakes(longFixture.session, longFixture.version)).toEqual([]);
  });
});

function args(f: { session: ReviewSession; version: ResultVersion }): [ReviewSession, ResultVersion] {
  return [f.session, f.version];
}

describe('mergeMistakes', () => {
  let n = 0;
  const id = () => `c${++n}`;
  const cand = (before: string, after: string) => ({ language: 'en' as const, before, after, explanation: '' });

  it('新しい間違いはカードにし、翌日から復習する', () => {
    const [card] = mergeMistakes([], [cand('had went', 'went')], T0, id);
    expect(card).toMatchObject({ before: 'had went', after: 'went', count: 1, createdAt: T0, lastSeenAt: T0 });
    expect(card.review.dueAt).toBe(T0 + DAY_MS);
  });

  it('表記ゆれだけ違う同じ間違いは回数を増やし、先の復習を1日後までに早める', () => {
    const [card] = mergeMistakes([], [cand('had went', 'went')], T0, id);
    const far = { ...card, review: { ...card.review, dueAt: T0 + 30 * DAY_MS } };
    const T1 = T0 + 5 * DAY_MS;
    const merged = mergeMistakes([far], [cand('Had  Went', 'went')], T1, id);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: card.id, count: 2, lastSeenAt: T1 });
    expect(merged[0].review.dueAt).toBe(T1 + DAY_MS);
  });

  it('キーは NFKC・大文字小文字・空白を正規化する', () => {
    expect(mistakeKey(' ＡＢＣ  d ', 'x')).toBe(mistakeKey('abc d', 'x'));
    expect(mistakeKey('a', 'b')).not.toBe(mistakeKey('a', 'c'));
  });

  it('dueCards は期限が来たものを古い順に返す', () => {
    const cards = mergeMistakes([], [cand('a1', 'b1'), cand('a2', 'b2'), cand('a3', 'b3')], T0, id);
    cards[0].review.dueAt = T0 + 3;
    cards[1].review.dueAt = T0 + 1;
    cards[2].review.dueAt = T0 + 100;
    expect(dueCards(cards, T0 + 10).map((c) => c.before)).toEqual(['a2', 'a1']);
  });
});
