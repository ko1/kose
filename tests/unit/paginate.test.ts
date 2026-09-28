import { describe, expect, it } from 'vitest';
import { paginate } from '../../src/shared/paginate';

describe('paginate', () => {
  const items = Array.from({ length: 45 }, (_, i) => i);

  it('指定したページの分だけ返す', () => {
    expect(paginate(items, 0, 20)).toEqual({ items: items.slice(0, 20), page: 0, pages: 3 });
    expect(paginate(items, 2, 20)).toEqual({ items: [40, 41, 42, 43, 44], page: 2, pages: 3 });
  });

  it('範囲外のページは最後（または最初）のページに寄せる', () => {
    expect(paginate(items, 5, 20).page).toBe(2);
    expect(paginate(items, -1, 20).page).toBe(0);
    expect(paginate([], 3, 20)).toEqual({ items: [], page: 0, pages: 1 });
  });
});
