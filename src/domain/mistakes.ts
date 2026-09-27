import { DAY_MS, initialReview, isDue } from './srs';
import type { LanguageCode, MistakeCard, ResultVersion, ReviewSession } from './types';

/** 保存する語句の上限（原文全体を保存しないため） */
export const MAX_PHRASE_CHARS = 40;

export interface MistakeCandidate {
  language: LanguageCode;
  before: string;
  after: string;
  explanationJa: string;
}

/** 重複判定のキー。表記ゆれ（全角半角・大文字小文字・空白）だけを吸収する */
export function mistakeKey(before: string, after: string): string {
  const normalize = (s: string) => s.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  return JSON.stringify([normalize(before), normalize(after)]);
}

/**
 * 解説から、自動保存してよい間違いを取り出す（spec §2 の条件）。
 * 同じ言語の校正で、右クリック直後の案の、客観的な誤りだけ。
 */
export function extractMistakes(session: ReviewSession, version: ResultVersion): MistakeCandidate[] {
  const explanation = version.explanation;
  const language = session.sourceLanguage;
  if (!explanation || version.origin !== 'initial') return [];
  if (language !== 'ja' && language !== 'en') return [];
  if (version.targetLanguage !== language || version.result.detectedSourceLanguage !== language) return [];

  const seen = new Set<string>();
  const out: MistakeCandidate[] = [];
  for (const c of explanation.changes) {
    const before = c.before.trim();
    const after = c.after.trim();
    if (c.type !== 'objective_error' || before === '' || after === '') continue;
    if (!session.sourceText.includes(c.before) || !version.result.revisedText.includes(c.after)) continue;
    if ([...before].length > MAX_PHRASE_CHARS || [...after].length > MAX_PHRASE_CHARS) continue;
    const key = mistakeKey(before, after);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ language, before, after, explanationJa: c.explanationJa });
  }
  return out;
}

/**
 * 既存のカードに候補を合わせる。同じ間違いは回数と最終検出時刻を更新し、
 * 次の復習が先なら1日後までに早める（繰り返す間違いは早めに復習する）。
 */
export function mergeMistakes(
  cards: readonly MistakeCard[],
  candidates: readonly MistakeCandidate[],
  now: number,
  newId: () => string,
): MistakeCard[] {
  const next = [...cards];
  for (const c of candidates) {
    const key = mistakeKey(c.before, c.after);
    const i = next.findIndex((card) => card.key === key && card.language === c.language);
    if (i >= 0) {
      const card = next[i];
      next[i] = {
        ...card,
        lastSeenAt: now,
        count: card.count + 1,
        review: { ...card.review, dueAt: Math.min(card.review.dueAt, now + DAY_MS) },
      };
    } else {
      next.push({ id: newId(), key, ...c, createdAt: now, lastSeenAt: now, count: 1, review: initialReview(now) });
    }
  }
  return next;
}

/** 出題できるカード（期限の早い順） */
export function dueCards(cards: readonly MistakeCard[], now: number): MistakeCard[] {
  return cards.filter((c) => isDue(c.review, now)).sort((a, b) => a.review.dueAt - b.review.dueAt);
}
