import { z } from 'zod';
import { mergeMistakes, MistakeCandidate, mistakeKey } from '../domain/mistakes';
import { rate } from '../domain/srs';
import { LANGUAGE_CODES, MistakeCard, Rating } from '../domain/types';
import { newId } from '../shared/ids';
import { withLock } from './lock';
import { M } from '../shared/messages';

/**
 * 間違いカードの保存先。koseウィンドウと設定画面の両方が読み書きし、変更通知で同期するため
 * chrome.storage.local に置く（短い語句だけなので容量は小さい）。
 */
const KEY = 'mistakes';
const EXPORT_FORMAT = 'kose-mistakes';

const reviewSchema = z.object({
  dueAt: z.number(),
  lastReviewedAt: z.number().optional(),
  repetitions: z.number().int().nonnegative(),
  easeFactor: z.number().positive(),
  intervalDays: z.number().nonnegative(),
});

const cardSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  language: z.enum(LANGUAGE_CODES),
  before: z.string().min(1),
  after: z.string().min(1),
  explanation: z.string(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  count: z.number().int().positive(),
  review: reviewSchema,
});

/** 壊れた項目は捨てて読む。解説の項目名が explanationJa だった頃のカードも読めるようにする */
function parseCards(raw: unknown): MistakeCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = cardSchema.safeParse(migrateCard(item));
    return parsed.success ? [parsed.data] : [];
  });
}

function migrateCard(item: unknown): unknown {
  if (typeof item !== 'object' || item === null) return item;
  const { explanationJa, ...rest } = item as Record<string, unknown>;
  return 'explanation' in rest || explanationJa === undefined ? rest : { ...rest, explanation: explanationJa };
}

export async function loadMistakes(): Promise<MistakeCard[]> {
  const stored = await chrome.storage.local.get(KEY);
  return parseCards(stored[KEY]);
}

/** 読み込み→変更→書き込みの間に、別のページ（koseウィンドウ・設定画面）の変更が割り込まないようにする */
function modify(fn: (cards: MistakeCard[]) => MistakeCard[]): Promise<MistakeCard[]> {
  return withLock(KEY, async () => {
    const next = fn(await loadMistakes());
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
}

export function saveMistakes(candidates: readonly MistakeCandidate[], now = Date.now()): Promise<MistakeCard[]> {
  return modify((cards) => mergeMistakes(cards, candidates, now, newId));
}

export function rateMistake(id: string, rating: Rating, now = Date.now()): Promise<MistakeCard[]> {
  return modify((cards) => cards.map((c) => (c.id === id ? { ...c, review: rate(c.review, rating, now) } : c)));
}

export function deleteMistake(id: string): Promise<MistakeCard[]> {
  return modify((cards) => cards.filter((c) => c.id !== id));
}

export function clearMistakes(): Promise<MistakeCard[]> {
  return modify(() => []);
}

export function onMistakesChanged(listener: (cards: MistakeCard[]) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && KEY in changes) listener(parseCards(changes[KEY].newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export function exportMistakes(cards: readonly MistakeCard[], now = Date.now()): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: new Date(now).toISOString(), cards }, null, 2);
}

/**
 * 書き出したJSONを読み込む。既にある間違い（同じ言語・同じキー）は手元の記録を残し、ないものだけ追加する。
 * 追加した件数を返す。形式が違えば例外。
 */
export async function importMistakes(json: string): Promise<number> {
  const data: unknown = JSON.parse(json);
  if (typeof data !== 'object' || data === null || (data as { format?: unknown }).format !== EXPORT_FORMAT) {
    throw new Error(M.errors.notMistakeExport);
  }
  const incoming = parseCards((data as { cards?: unknown }).cards);
  let added = 0;
  await modify((cards) => {
    const known = new Set(cards.map((c) => `${c.language}:${c.key}`));
    const next = [...cards];
    for (const card of incoming) {
      // キーは保存時の正規化で作り直す（手で編集されたファイルでも重複判定が狂わないように）
      const key = mistakeKey(card.before, card.after);
      if (known.has(`${card.language}:${key}`)) continue;
      known.add(`${card.language}:${key}`);
      next.push({ ...card, id: newId(), key });
      added++;
    }
    return next;
  });
  return added;
}
