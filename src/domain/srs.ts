import type { Rating, ReviewState } from './types';

/**
 * 簡易SM-2。評価（Again/Hard/Good/Easy）から次の復習時刻を決める。
 * 将来 FSRS などに差し替えられるよう、この関数群だけで完結させる。
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Again のあと、同じ日のうちにもう一度出す間隔 */
export const AGAIN_DELAY_MS = 10 * 60 * 1000;
const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;

/** 新しいカードは作った日には出さない（最初の間隔は1日） */
export function initialReview(now: number): ReviewState {
  return { dueAt: now + DAY_MS, repetitions: 0, easeFactor: INITIAL_EASE, intervalDays: 0 };
}

export function rate(state: ReviewState, rating: Rating, now: number): ReviewState {
  const prev = state.intervalDays;
  const ease = (delta: number) => Math.max(MIN_EASE, state.easeFactor + delta);
  const next = (intervalDays: number, easeFactor: number, repetitions: number): ReviewState => ({
    dueAt: now + intervalDays * DAY_MS,
    lastReviewedAt: now,
    repetitions,
    easeFactor,
    intervalDays,
  });

  switch (rating) {
    case 'again':
      return { ...next(0, ease(-0.2), 0), dueAt: now + AGAIN_DELAY_MS };
    case 'hard':
      return next(Math.max(1, Math.round(prev * 1.2)), ease(-0.15), state.repetitions + 1);
    case 'good':
      return next(goodInterval(state), state.easeFactor, state.repetitions + 1);
    case 'easy':
      return next(
        state.repetitions === 0 ? 3 : Math.max(Math.round(goodInterval(state) * 1.3), prev + 1),
        ease(0.15),
        state.repetitions + 1,
      );
  }
}

function goodInterval(state: ReviewState): number {
  if (state.repetitions === 0) return 1;
  if (state.repetitions === 1) return 3;
  return Math.max(Math.round(state.intervalDays * state.easeFactor), state.intervalDays + 1);
}

export function isDue(state: ReviewState, now: number): boolean {
  return state.dueAt <= now;
}
