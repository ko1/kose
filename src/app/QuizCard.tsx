import { useMemo, useState } from 'react';
import { quizChoices, type QuizChoice } from '../domain/quiz';
import type { MistakeCard, Rating } from '../domain/types';
import { M } from '../shared/messages';

/**
 * 1枚分の復習クイズ（選択式）。誤った表現と直した表現から正しいほうを選ぶ。
 * 違う箇所に印を付けるので、一字一句見比べなくてよい。正解なら Good、不正解なら Again で自動的に記録する。
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
  const [chosen, setChosen] = useState<QuizChoice | null>(null);

  const choose = (choice: QuizChoice) => {
    if (chosen) return;
    setChosen(choice);
    onRate(choice.correct ? 'good' : 'again');
  };

  return (
    <div className="quiz">
      <p className="quiz-prompt">
        {M.quiz.choosePrompt(M.languages[card.language].name)}
        {card.count > 1 && <span className="meta">{M.quiz.times(card.count)}</span>}
      </p>
      <div className="choices" role="group" aria-label={M.quiz.choicesLabel}>
        {choices.map((choice) => (
          <button
            key={choice.text}
            className={`choice${chosen ? (choice.correct ? ' choice-correct' : choice === chosen ? ' choice-wrong' : '') : ''}`}
            onClick={() => choose(choice)}
            disabled={chosen !== null}
          >
            {choice.parts.map((part, i) =>
              part.mark === 'diff' ? (
                <mark key={i}>{part.text}</mark>
              ) : part.mark === 'gap' ? (
                <span key={i} className="gap" aria-hidden />
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
          </button>
        ))}
      </div>
      {chosen && (
        <>
          <p className={chosen.correct ? 'quiz-result correct' : 'quiz-result wrong'}>
            {chosen.correct ? M.quiz.correct : M.quiz.incorrect}
          </p>
          {card.explanation && <p className="change-explanation">{card.explanation}</p>}
          {onNext && <button onClick={onNext}>{M.quiz.next}</button>}
        </>
      )}
    </div>
  );
}
