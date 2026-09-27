import { useState } from 'react';
import { RATINGS, type MistakeCard, type Rating } from '../domain/types';
import { M } from '../shared/messages';

export const RATING_LABELS: Record<Rating, string> = M.quiz.ratings;

/**
 * 1枚分の復習クイズ。間違えた表現を見て直し方を考え、答えを見て自己評価する。
 * 入力欄は考えを書き留めるためだけのもので、採点はしない（言い換えでも正解になりうるため）。
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
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [rated, setRated] = useState<Rating | null>(null);

  return (
    <div className="quiz">
      <p className="quiz-prompt">
        {M.quiz.prompt(M.languages[card.language].name)}
        {card.count > 1 && <span className="meta">{M.quiz.times(card.count)}</span>}
      </p>
      <p className="quiz-before">
        <del>{card.before}</del>
      </p>
      <input
        type="text"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) setRevealed(true);
        }}
        placeholder={M.quiz.inputPlaceholder}
        aria-label={M.quiz.inputLabel}
      />
      {!revealed ? (
        <button onClick={() => setRevealed(true)}>{M.quiz.reveal}</button>
      ) : (
        <>
          <p className="quiz-after">
            <ins>{card.after}</ins>
          </p>
          {card.explanation && <p className="change-explanation">{card.explanation}</p>}
          {rated === null ? (
            <div className="ratings" role="group" aria-label={M.quiz.ratingsLabel}>
              {RATINGS.map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setRated(r);
                    onRate(r);
                  }}
                >
                  {RATING_LABELS[r]}
                </button>
              ))}
            </div>
          ) : (
            <p className="note">
              {M.quiz.recorded(RATING_LABELS[rated])}
              {onNext && (
                <>
                  {' '}
                  <button onClick={onNext}>{M.quiz.next}</button>
                </>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
