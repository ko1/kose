import { describe, expect, it } from 'vitest';
import { AGAIN_DELAY_MS, DAY_MS, initialReview, isDue, lapse, rate } from '../../src/domain/srs';

const T0 = Date.UTC(2026, 0, 1);

describe('簡易SM-2', () => {
  it('新しいカードは作った日には出さない（1日後から）', () => {
    const s = initialReview(T0);
    expect(isDue(s, T0 + DAY_MS - 1)).toBe(false);
    expect(isDue(s, T0 + DAY_MS)).toBe(true);
  });

  it('Good を続けると 1日 → 3日 → 間隔×易しさ と伸びる', () => {
    let s = initialReview(T0);
    s = rate(s, 'good', T0);
    expect(s).toMatchObject({ intervalDays: 1, repetitions: 1, dueAt: T0 + DAY_MS, lastReviewedAt: T0 });
    s = rate(s, 'good', T0);
    expect(s.intervalDays).toBe(3);
    s = rate(s, 'good', T0);
    expect(s.intervalDays).toBe(Math.round(3 * 2.5));
  });

  it('Again は連続回数を戻し、10分後にもう一度出す', () => {
    const s = rate(rate(rate(initialReview(T0), 'good', T0), 'good', T0), 'again', T0);
    expect(s).toMatchObject({ repetitions: 0, intervalDays: 0, dueAt: T0 + AGAIN_DELAY_MS });
    expect(s.easeFactor).toBeCloseTo(2.3);
    expect(rate(s, 'good', T0).intervalDays).toBe(1);
  });

  it('Hard は間隔を少しだけ伸ばし、Easy は大きく伸ばす。易しさは下限 1.3', () => {
    const base = { dueAt: T0, repetitions: 3, easeFactor: 2.5, intervalDays: 10 };
    expect(rate(base, 'hard', T0).intervalDays).toBe(12);
    expect(rate(base, 'easy', T0).intervalDays).toBe(Math.round(25 * 1.3));
    expect(rate(base, 'easy', T0).easeFactor).toBeCloseTo(2.65);
    let s = base;
    for (let i = 0; i < 20; i++) s = rate(s, 'hard', T0);
    expect(s.easeFactor).toBe(1.3);
  });

  it('評価ごとに次の復習日が変わる', () => {
    const s = rate(initialReview(T0), 'good', T0);
    const due = (r: 'again' | 'hard' | 'good' | 'easy') => rate(s, r, T0).dueAt;
    expect(due('again')).toBeLessThan(due('hard'));
    expect(due('hard')).toBeLessThan(due('good'));
    expect(due('good')).toBeLessThan(due('easy'));
  });

  it('実際の文章での再発は覚え直しにし、1日以内に出す（先の期限を遅らせない）', () => {
    const learned = { dueAt: T0 + 30 * DAY_MS, repetitions: 4, easeFactor: 1.4, intervalDays: 30 };
    expect(lapse(learned, T0)).toMatchObject({ dueAt: T0 + DAY_MS, repetitions: 0, intervalDays: 0, easeFactor: 1.3 });
    const soon = { ...learned, dueAt: T0 + 60_000 };
    expect(lapse(soon, T0).dueAt).toBe(T0 + 60_000);
  });
});
