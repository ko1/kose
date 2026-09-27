import { z } from 'zod';
import type { ChatReply, Explanation, RewriteResult } from '../domain/types';

// モデルに返させるJSONの形。OpenAI Structured Outputs の strict モード、
// Anthropic の output_config.format、Prompt API の responseConstraint に同じ JSON Schema を渡す。

/** 1段目: 改稿文だけ（安く・速く） */
export const rewriteOutputSchema = z.strictObject({
  revisedText: z.string(),
  detectedSourceLanguage: z.enum(['ja', 'en', 'mixed', 'unknown']),
});

/** 2段目: 解説 */
export const explainOutputSchema = z.strictObject({
  explanationJa: z.string(),
  changes: z.array(
    z.strictObject({
      before: z.string(),
      after: z.string(),
      type: z.enum(['objective_error', 'style', 'uncertain']),
      explanationJa: z.string(),
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
  replyJa: z.string(),
  revisedText: z.string(),
});

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return json;
}

export const rewriteJsonSchema = (): Record<string, unknown> => toJsonSchema(rewriteOutputSchema);
export const explainJsonSchema = (withStructure = false): Record<string, unknown> =>
  toJsonSchema(withStructure ? explainWithStructureOutputSchema : explainOutputSchema);
export const chatJsonSchema = (): Record<string, unknown> => toJsonSchema(chatOutputSchema);

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
    throw new InvalidModelOutputError('AIの応答がJSONとして解釈できませんでした。');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidModelOutputError('AIの応答が想定した形式ではありませんでした。');
  }
  return parsed.data;
}

/** 1段目の出力を検証する。JSONとして不正、スキーマ違反、改稿文が空なら例外 */
export function parseRewriteOutput(raw: string): RewriteResult {
  const out = parseJson(raw, rewriteOutputSchema);
  if (out.revisedText.trim() === '') {
    throw new InvalidModelOutputError('AIの応答に改稿文が含まれていませんでした。');
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
  if (out.replyJa.trim() === '') {
    throw new InvalidModelOutputError('AIの応答に返答が含まれていませんでした。');
  }
  const revised = out.revisedText.trim();
  return {
    replyJa: out.replyJa,
    revisedText: revised === '' || revised === currentRevisedText.trim() ? undefined : out.revisedText,
  };
}
