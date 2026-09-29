import type { MistakeCard } from './types';

/** 選択式の復習クイズ。誤った表現と直した表現をランダムな順に並べ、「正しいのはどちら？」と聞く */
export interface QuizChoice {
  text: string;
  correct: boolean;
}

export function quizChoices(card: Pick<MistakeCard, 'before' | 'after'>, random: () => number = Math.random): QuizChoice[] {
  const wrong: QuizChoice = { text: card.before, correct: false };
  const right: QuizChoice = { text: card.after, correct: true };
  return random() < 0.5 ? [wrong, right] : [right, wrong];
}
