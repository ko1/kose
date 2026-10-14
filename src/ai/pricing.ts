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

/**
 * トークン数から料金を計算する。料金表にないモデルは undefined。
 * キャッシュ書き込みは入力の1.25倍、読み込みは0.1倍で数える。Web 検索は1回 $0.01。
 */
export function anthropicCostUsd(
  model: string,
  tokens: { input: number; output: number; cacheWrite?: number; cacheRead?: number; webSearches?: number },
): number | undefined {
  const price = priceOf(model);
  if (!price) return undefined;
  const input = tokens.input + (tokens.cacheWrite ?? 0) * 1.25 + (tokens.cacheRead ?? 0) * 0.1;
  return (input * price.input + tokens.output * price.output) / 1_000_000 + (tokens.webSearches ?? 0) * WEB_SEARCH_USD;
}

/** Web 検索1回の料金（1,000回あたり $10） */
const WEB_SEARCH_USD = 0.01;

/** "$0.0015" のような表示（有効数字2桁）。料金が分からなければ null */
export function formatCost(usage: Usage | undefined): string | null {
  if (usage?.costUsd === undefined) return null;
  return usage.costUsd < 0.0001 ? '<$0.0001' : `$${Number(usage.costUsd.toPrecision(2))}`;
}
