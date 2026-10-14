import { z } from 'zod';
import { M } from '../shared/messages';
import { VERDICTS, type ChatReply, type Explanation, type FactClaim, type RewriteResult } from '../domain/types';

// モデルに返させるJSONの形。OpenAI Structured Outputs の strict モード、
// Anthropic の output_config.format、Prompt API の responseConstraint に同じ JSON Schema を渡す。

/** 1段目: 改稿文だけ（安く・速く） */
export const rewriteOutputSchema = z.strictObject({
  revisedText: z.string(),
  detectedSourceLanguage: z.enum(['ja', 'en', 'mixed', 'unknown']),
});

/** 2段目: 解説 */
export const explainOutputSchema = z.strictObject({
  explanation: z.string(),
  changes: z.array(
    z.strictObject({
      before: z.string(),
      after: z.string(),
      type: z.enum(['objective_error', 'style', 'uncertain']),
      explanation: z.string(),
    }),
  ),
  nuanceWarnings: z.array(z.string()),
});

/** 2段目（長文）: 解説に構成の指摘を加える */
export const explainWithStructureOutputSchema = explainOutputSchema.extend({
  structure: z.strictObject({
    outline: z.array(z.string()),
    issues: z.array(z.strictObject({ problem: z.string(), suggestion: z.string() })),
  }),
});

/**
 * ニュアンス相談: 返答と、新しい改稿案（作らないときは空文字）。
 * null を使うと各APIの構造化出力で扱いが分かれるので、空文字で「なし」を表す。
 */
export const chatOutputSchema = z.strictObject({
  reply: z.string(),
  revisedText: z.string(),
});

/** 事実確認（校閲）: 原文の主張ごとの判定と根拠 */
export const factCheckOutputSchema = z.strictObject({
  summary: z.string(),
  claims: z.array(
    z.strictObject({
      quote: z.string(),
      claim: z.string(),
      verdict: z.enum(VERDICTS),
      explanation: z.string(),
      sources: z.array(z.strictObject({ title: z.string(), url: z.string() })),
    }),
  ),
});

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return json;
}

export const rewriteJsonSchema = (): Record<string, unknown> => toJsonSchema(rewriteOutputSchema);
export const explainJsonSchema = (withStructure = false): Record<string, unknown> =>
  toJsonSchema(withStructure ? explainWithStructureOutputSchema : explainOutputSchema);
export const chatJsonSchema = (): Record<string, unknown> => toJsonSchema(chatOutputSchema);
export const factCheckJsonSchema = (): Record<string, unknown> => toJsonSchema(factCheckOutputSchema);

export class InvalidModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidModelOutputError';
  }
}

function parseJson<T>(raw: string, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new InvalidModelOutputError(M.errors.invalidJson);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidModelOutputError(M.errors.invalidShape);
  }
  return parsed.data;
}

/** 1段目の出力を検証する。JSONとして不正、スキーマ違反、改稿文が空なら例外 */
export function parseRewriteOutput(raw: string): RewriteResult {
  const out = parseJson(raw, rewriteOutputSchema);
  if (out.revisedText.trim() === '') {
    throw new InvalidModelOutputError(M.errors.noRewrite);
  }
  return out;
}

/**
 * 2段目の出力を検証する。before/after が原文・改稿文に実在しない変更点は除外する
 * （誤りの根拠にしない）。
 */
export function parseExplainOutput(
  raw: string,
  sourceText: string,
  revisedText: string,
  withStructure = false,
): Explanation {
  const out: Omit<Explanation, 'droppedChanges'> = withStructure
    ? parseJson(raw, explainWithStructureOutputSchema)
    : parseJson(raw, explainOutputSchema);
  const changes = out.changes.filter(
    (c) =>
      !(c.before === '' && c.after === '') &&
      (c.before === '' || sourceText.includes(c.before)) &&
      (c.after === '' || revisedText.includes(c.after)),
  );
  return { ...out, changes, droppedChanges: out.changes.length - changes.length };
}

function stripCodeFence(raw: string): string {
  const m = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : raw;
}

/** 相談の出力を検証する。改稿案が空、または表示中の案と同じなら「改稿なし」とする */
export function parseChatOutput(raw: string, currentRevisedText: string): ChatReply {
  const out = parseJson(raw, chatOutputSchema);
  if (out.reply.trim() === '') {
    throw new InvalidModelOutputError(M.errors.noReply);
  }
  const revised = out.revisedText.trim();
  return {
    reply: out.reply,
    revisedText: revised === '' || revised === currentRevisedText.trim() ? undefined : out.revisedText,
  };
}

/**
 * 事実確認の出力を検証する。根拠は検索で実際に見つかった URL（searchedUrls）だけを残し
 * （AIが作った URL を見せない）、根拠の残らない判定は「確認できず」に落とす。
 * 原文と照合できない引用は空にする（原文での強調表示に使わない）。
 */
export function parseFactCheckOutput(
  input: unknown,
  sourceText: string,
  searchedUrls: ReadonlySet<string>,
): { summary: string; claims: FactClaim[] } {
  const parsed = factCheckOutputSchema.safeParse(input);
  if (!parsed.success) throw new InvalidModelOutputError(M.errors.invalidShape);
  const claims = parsed.data.claims
    .filter((c) => c.claim.trim() !== '')
    .map((c): FactClaim => {
      const sources = distinctBy(
        c.sources.filter((s) => searchedUrls.has(normalizeUrl(s.url))),
        (s) => normalizeUrl(s.url),
      );
      const quote = c.quote.trim();
      return {
        ...c,
        quote: quote !== '' && sourceText.includes(quote) ? quote : '',
        verdict: sources.length === 0 ? 'unverified' : c.verdict,
        sources,
      };
    });
  return { summary: parsed.data.summary, claims };
}

/** 検索結果と AI の引用で表記が揺れても同じ URL とみなす（末尾の / と #以降を無視） */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/#.*$/, '').replace(/\/+$/, '');
}

function distinctBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
