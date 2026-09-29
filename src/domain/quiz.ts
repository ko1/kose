import { diffTexts } from './diff';
import type { MistakeCard } from './types';

/**
 * 選択式の復習クイズ。誤った表現と直した表現を並べ、「正しいのはどちら？」と聞く。
 * 一字一句見比べなくて済むよう、2つの違う箇所に同じ（どちらが正しいかは示さない）印を付ける。
 * 片方にしかない箇所は、もう片方の同じ位置に隙間の印（gap）を出す。
 */
export type ChoicePart = { text: string; mark: 'same' | 'diff' | 'gap' };

export interface QuizChoice {
  text: string;
  correct: boolean;
  parts: ChoicePart[];
}

export function quizChoices(card: Pick<MistakeCard, 'before' | 'after'>, random: () => number = Math.random): QuizChoice[] {
  const segments = diffTexts(card.before, card.after);
  const partsFor = (side: 'before' | 'after'): ChoicePart[] => {
    if (!segments) return [{ text: side === 'before' ? card.before : card.after, mark: 'same' }];
    const own = side === 'before' ? 'delete' : 'insert';
    const parts = segments.map((s): ChoicePart =>
      s.type === 'equal' ? { text: s.text, mark: 'same' } : s.type === own ? { text: s.text, mark: 'diff' } : { text: '', mark: 'gap' },
    );
    // 置き換え（違う箇所のすぐ隣の隙間）では隙間の印は要らない
    return parts.filter((p, i) => p.mark !== 'gap' || (parts[i - 1]?.mark !== 'diff' && parts[i + 1]?.mark !== 'diff'));
  };
  const wrong: QuizChoice = { text: card.before, correct: false, parts: partsFor('before') };
  const right: QuizChoice = { text: card.after, correct: true, parts: partsFor('after') };
  return random() < 0.5 ? [wrong, right] : [right, wrong];
}
