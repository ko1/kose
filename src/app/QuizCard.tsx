import { useState } from 'react';
import { LANGUAGE_LABELS } from '../domain/labels';
import { RATINGS, type MistakeCard, type Rating } from '../domain/types';

export const RATING_LABELS: Record<Rating, string> = {
  again: 'もう一度',
  hard: '難しい',
  good: 'できた',
  easy: '簡単',
};

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
        {LANGUAGE_LABELS[card.language].name}の誤りを直してください
        {card.count > 1 && <span className="meta">（{card.count}回目の間違い）</span>}
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
        placeholder="直した表現（入力しなくても大丈夫です）"
        aria-label="直した表現"
      />
      {!revealed ? (
        <button onClick={() => setRevealed(true)}>答えを見る</button>
      ) : (
        <>
          <p className="quiz-after">
            <ins>{card.after}</ins>
          </p>
          {card.explanationJa && <p className="change-explanation">{card.explanationJa}</p>}
          {rated === null ? (
            <div className="ratings" role="group" aria-label="自己評価">
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
              「{RATING_LABELS[rated]}」で記録しました。
              {onNext && (
                <>
                  {' '}
                  <button onClick={onNext}>次へ</button>
                </>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
