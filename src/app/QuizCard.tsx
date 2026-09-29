import { useMemo, useState } from 'react';
import { quizChoices } from '../domain/quiz';
import type { MistakeCard, Rating } from '../domain/types';
import { M } from '../shared/messages';

/**
 * 1枚分の復習クイズ（選択式）。誤った表現と直した表現から正しいほうを選ぶ。
 * 正解なら Good、不正解なら Again で自動的に記録する。
 */
export function QuizCard({
  card,
  onRate,
  onNext,
}: {
  card: MistakeCard;
  onRate: (rating: Rating) => void;
  /** 評価後に「次へ」を出す（まとめて復習するとき） */
  onNext?: () => void;
}) {
  // 並び順は表示のたびに変えない
  const choices = useMemo(() => quizChoices(card), [card.id]);
  const [chosen, setChosen] = useState<number | null>(null);
  const correct = chosen !== null && choices[chosen].correct;

  const choose = (index: number) => {
    if (chosen !== null) return;
    setChosen(index);
    onRate(choices[index].correct ? 'good' : 'again');
  };

  return (
    <div className="quiz">
      <p className="quiz-prompt">
        {M.quiz.choosePrompt(M.languages[card.language].name)}
        {card.count > 1 && <span className="meta">{M.quiz.times(card.count)}</span>}
      </p>
      <div className="choices" role="group" aria-label={M.quiz.choicesLabel}>
        {choices.map((c, i) => (
          <button
            key={i}
            className={`choice${chosen !== null ? (c.correct ? ' choice-correct' : i === chosen ? ' choice-wrong' : '') : ''}`}
            onClick={() => choose(i)}
            disabled={chosen !== null}
          >
            {c.text}
          </button>
        ))}
      </div>
      {chosen !== null && (
        <>
          <p className={correct ? 'quiz-result correct' : 'quiz-result wrong'}>
            {correct ? M.quiz.correct : M.quiz.incorrect}
          </p>
          {card.explanation && <p className="change-explanation">{card.explanation}</p>}
          {onNext && <button onClick={onNext}>{M.quiz.next}</button>}
        </>
      )}
    </div>
  );
}
