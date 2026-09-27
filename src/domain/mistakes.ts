import { initialReview, isDue, lapse } from './srs';
import type { LanguageCode, MistakeCard, ResultVersion, ReviewSession } from './types';

/** 保存する語句の上限（原文全体を保存しないため） */
export const MAX_PHRASE_CHARS = 40;

/** URL・メールアドレス・ファイルパスらしい文字列（個人や組織を特定しうるので保存しない） */
const SENSITIVE = /\b(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.-]+|(?:^|\s)(?:[A-Za-z]:\\|~?\/)\S+/gi;

function containsSensitive(text: string): boolean {
  SENSITIVE.lastIndex = 0;
  return SENSITIVE.test(text);
}

/** 解説文の中の URL・メールアドレス・パスを伏せる */
export function scrubSensitive(text: string): string {
  return text.replace(SENSITIVE, (m) => (/^\s/.test(m) ? `${m[0]}…` : '…'));
}

export interface MistakeCandidate {
  language: LanguageCode;
  before: string;
  after: string;
  explanation: string;
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
    // 短い選択範囲では語句が原文・改稿文そのものになりうる。原文全体は保存しない
    if (before === session.sourceText.trim() || after === version.result.revisedText.trim()) continue;
    if (containsSensitive(before) || containsSensitive(after)) continue;
    const key = mistakeKey(before, after);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ language, before, after, explanation: scrubSensitive(c.explanation) });
  }
  return out;
}

/**
 * 既存のカードに候補を合わせる。同じ間違いは回数と最終検出時刻を更新し、
 * 覚え直しにして1日以内に復習に出す（実際の文章で再発した＝覚えていなかった）。
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
        review: lapse(card.review, now),
      };
    } else {
      next.push({ id: newId(), key, ...c, createdAt: now, lastSeenAt: now, count: 1, review: initialReview(now) });
    }
  }
  return next;
}

/**
 * 解説の変更点が、この案より前に記録済みの間違いか。再発なら「前にも同じ誤り」と表示する。
 * 同じ言語の校正（原文の言語 = 改稿の言語）のときだけ照合する。
 */
export function knownMistake(
  cards: readonly MistakeCard[],
  session: ReviewSession,
  version: ResultVersion,
  change: { before: string; after: string; type: string },
): MistakeCard | undefined {
  const language = session.sourceLanguage;
  if (change.type !== 'objective_error' || (language !== 'ja' && language !== 'en')) return undefined;
  if (version.targetLanguage !== language) return undefined;
  const key = mistakeKey(change.before.trim(), change.after.trim());
  return cards.find((c) => c.language === language && c.key === key && c.createdAt < version.createdAt);
}

/** 出題できるカード（期限の早い順） */
export function dueCards(cards: readonly MistakeCard[], now: number): MistakeCard[] {
  return cards.filter((c) => isDue(c.review, now)).sort((a, b) => a.review.dueAt - b.review.dueAt);
}
