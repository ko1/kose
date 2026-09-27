import { describe, expect, it } from 'vitest';
import { anthropicCostUsd, formatCost } from '../../src/ai/pricing';

describe('pricing', () => {
  it('モデルごとの料金でトークン数から計算する', () => {
    expect(anthropicCostUsd('claude-haiku-4-5', { input: 1_000_000, output: 0 })).toBe(1);
    expect(anthropicCostUsd('claude-opus-5', { input: 1000, output: 1000 })).toBeCloseTo(0.03);
    expect(anthropicCostUsd('claude-sonnet-5', { input: 0, output: 0, cacheWrite: 1_000_000, cacheRead: 1_000_000 })).toBeCloseTo(
      2 * 1.25 + 2 * 0.1,
    );
    expect(anthropicCostUsd('unknown-model', { input: 1, output: 1 })).toBeUndefined();
  });

  it('応答の日付付きモデル名でも料金を引ける', () => {
    expect(anthropicCostUsd('claude-haiku-4-5-20251001', { input: 609, output: 177 })).toBeCloseTo(0.001494);
    expect(anthropicCostUsd('claude-haiku-4-50', { input: 1, output: 1 })).toBeUndefined();
  });

  it('円で表示する（料金が分からなければ null）', () => {
    const u = (costUsd?: number) => ({ model: 'm', inputTokens: 0, outputTokens: 0, costUsd });
    expect(formatCost(u(0.0013))).toBe('約0.2円');
    expect(formatCost(u(0.0001))).toBe('0.1円未満');
    expect(formatCost(u(0.2))).toBe('約30円');
    expect(formatCost(u())).toBeNull();
    expect(formatCost(undefined)).toBeNull();
  });
});
