import type { Usage } from '../domain/types';

/** 100万トークンあたりの料金（USD、入力/出力）。Anthropic API の定価 */
const ANTHROPIC_PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
};

/** 応答のモデル名は日付付き（claude-haiku-4-5-20251001 など）のことがあるので先頭一致で引く */
function priceOf(model: string): { input: number; output: number } | undefined {
  const key = Object.keys(ANTHROPIC_PRICES)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? ANTHROPIC_PRICES[key] : undefined;
}

/** 表示用の為替レート（概算） */
export const JPY_PER_USD = 150;

/**
 * トークン数から料金を計算する。料金表にないモデルは undefined。
 * キャッシュ書き込みは入力の1.25倍、読み込みは0.1倍で数える。
 */
export function anthropicCostUsd(
  model: string,
  tokens: { input: number; output: number; cacheWrite?: number; cacheRead?: number },
): number | undefined {
  const price = priceOf(model);
  if (!price) return undefined;
  const input = tokens.input + (tokens.cacheWrite ?? 0) * 1.25 + (tokens.cacheRead ?? 0) * 0.1;
  return (input * price.input + tokens.output * price.output) / 1_000_000;
}

/** 「約0.2円」のような表示。料金が分からなければ null */
export function formatCost(usage: Usage | undefined): string | null {
  if (usage?.costUsd === undefined) return null;
  const yen = usage.costUsd * JPY_PER_USD;
  return yen < 0.1 ? '0.1円未満' : `約${yen < 10 ? yen.toFixed(1) : Math.round(yen)}円`;
}
