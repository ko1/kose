import { z } from 'zod';
import { M } from '../shared/messages';
import { VERDICTS, type ChatReply, type Explanation, type FactClaim, type FactSource, type RewriteResult } from '../domain/types';

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
 * 相談: 返答と、新しい改稿案（作らないときは空文字）。
 * null を使うと各APIの構造化出力で扱いが分かれるので、空文字で「なし」を表す。
 */
export const chatOutputSchema = z.strictObject({
  reply: z.string(),
  revisedText: z.string(),
});

const sourceSchema = z.strictObject({ title: z.string(), url: z.string() });

/** Web 検索つきの相談: 返答に、頼った出典を添える（Anthropic のツールの引数で受け取る） */
export const chatWithSourcesOutputSchema = chatOutputSchema.extend({
  sources: z.array(sourceSchema),
});

/** 事実確認（校閲）1段目: 原文から確かめる主張を抜き出す */
export const factClaimsOutputSchema = z.strictObject({
  claims: z.array(z.strictObject({ quote: z.string(), claim: z.string() })),
});

/** 事実確認 2段目: 主張ひとつの判定と根拠（Anthropic のツールの引数で受け取る） */
export const claimVerdictOutputSchema = z.strictObject({
  verdict: z.enum(VERDICTS),
  explanation: z.string(),
  sources: z.array(sourceSchema),
});

/** 事実確認 3段目: 全体の評価 */
export const factSummaryOutputSchema = z.strictObject({ summary: z.string() });

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return json;
}

export const rewriteJsonSchema = (): Record<string, unknown> => toJsonSchema(rewriteOutputSchema);
export const explainJsonSchema = (withStructure = false): Record<string, unknown> =>
  toJsonSchema(withStructure ? explainWithStructureOutputSchema : explainOutputSchema);
export const chatJsonSchema = (): Record<string, unknown> => toJsonSchema(chatOutputSchema);
export const chatWithSourcesJsonSchema = (): Record<string, unknown> => toJsonSchema(chatWithSourcesOutputSchema);
export const factClaimsJsonSchema = (): Record<string, unknown> => toJsonSchema(factClaimsOutputSchema);
export const claimVerdictJsonSchema = (): Record<string, unknown> => toJsonSchema(claimVerdictOutputSchema);
export const factSummaryJsonSchema = (): Record<string, unknown> => toJsonSchema(factSummaryOutputSchema);

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

/**
 * 相談の出力を検証する。改稿案が空、または表示中の案と同じなら「改稿なし」とする。
 * 改稿がない（事実確認だけした）ときは案を作らない
 */
export function parseChatOutput(raw: string, currentRevisedText: string | undefined): ChatReply {
  return checkChatReply(parseJson(raw, chatOutputSchema), currentRevisedText);
}

/**
 * Web 検索つきの相談の出力（ツールの引数）を検証する。出典は検索や事実確認で実際に見つかった
 * URL（allowedUrls、normalizeUrl 済み）だけを残す
 */
export function parseChatWithSourcesOutput(
  input: unknown,
  currentRevisedText: string | undefined,
  allowedUrls: ReadonlySet<string>,
): ChatReply {
  const parsed = chatWithSourcesOutputSchema.safeParse(input);
  if (!parsed.success) throw new InvalidModelOutputError(M.errors.invalidShape);
  const reply = checkChatReply(parsed.data, currentRevisedText);
  const sources = keepFoundSources(parsed.data.sources, allowedUrls);
  return sources.length > 0 ? { ...reply, sources } : reply;
}

function checkChatReply(out: { reply: string; revisedText: string }, currentRevisedText: string | undefined): ChatReply {
  if (out.reply.trim() === '') {
    throw new InvalidModelOutputError(M.errors.noReply);
  }
  const revised = out.revisedText.trim();
  return {
    reply: out.reply,
    revisedText:
      currentRevisedText === undefined || revised === '' || revised === currentRevisedText.trim()
        ? undefined
        : out.revisedText,
  };
}

/**
 * 抜き出した主張を検証する。原文と照合できない引用は空にする（原文での強調表示に使わない）
 */
export function parseFactClaimsOutput(raw: string, sourceText: string): Pick<FactClaim, 'quote' | 'claim'>[] {
  return parseJson(raw, factClaimsOutputSchema)
    .claims.filter((c) => c.claim.trim() !== '')
    .map((c) => {
      const quote = c.quote.trim();
      return { quote: quote !== '' && sourceText.includes(quote) ? quote : '', claim: c.claim };
    });
}

/**
 * 主張ひとつの判定を検証する。根拠は検索で実際に見つかった URL（searchedUrls）だけを残し
 * （AIが作った URL を見せない）、根拠の残らない判定は「確認できず」に落とす。
 */
export function parseClaimVerdictOutput(
  input: unknown,
  target: Pick<FactClaim, 'quote' | 'claim'>,
  searchedUrls: ReadonlySet<string>,
): FactClaim {
  const parsed = claimVerdictOutputSchema.safeParse(input);
  if (!parsed.success) throw new InvalidModelOutputError(M.errors.invalidShape);
  const sources = keepFoundSources(parsed.data.sources, searchedUrls);
  return {
    ...target,
    verdict: sources.length === 0 ? 'unverified' : parsed.data.verdict,
    explanation: parsed.data.explanation,
    sources,
  };
}

export function parseFactSummaryOutput(raw: string): string {
  return parseJson(raw, factSummaryOutputSchema).summary;
}

/** 実際に見つかった URL の出典だけを、重複を除いて残す */
function keepFoundSources(sources: FactSource[], foundUrls: ReadonlySet<string>): FactSource[] {
  return distinctBy(
    sources.filter((s) => foundUrls.has(normalizeUrl(s.url))),
    (s) => normalizeUrl(s.url),
  );
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
