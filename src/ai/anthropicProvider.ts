import Anthropic from '@anthropic-ai/sdk';
import { M } from '../shared/messages';
import type {
  ChatReply,
  ChatRequest,
  Explanation,
  ExplainRequest,
  FactCheckProgress,
  FactCheckRequest,
  LanguageCode,
  PartialExplanation,
  RewriteRequest,
  RewriteResult,
  Usage,
} from '../domain/types';
import { distinct, extractPartialExplanation, extractPartialStringField } from './partialJson';
import { anthropicCostUsd } from './pricing';
import {
  buildChatSystemPrompt,
  buildExplainPrompt,
  buildRewritePrompt,
  chatHistoryMessages,
  EXPLAIN_SYSTEM_PROMPT,
  FACT_CHECK_SYSTEM_PROMPT,
  FACT_CHECK_TOOL_NAME,
  buildFactCheckPrompt,
  initialMessages,
  REWRITE_SYSTEM_PROMPT,
} from './prompts';
import { AIProvider, FactCheckResult, ProviderAvailability, ProviderError } from './provider';
import {
  chatJsonSchema,
  explainJsonSchema,
  factCheckJsonSchema,
  InvalidModelOutputError,
  normalizeUrl,
  parseChatOutput,
  parseExplainOutput,
  parseFactCheckOutput,
  parseRewriteOutput,
  rewriteJsonSchema,
} from './schema';

export const ANTHROPIC_ORIGIN = 'https://api.anthropic.com/*';

export type AnthropicEffort = 'low' | 'medium' | 'high';

export interface AnthropicConfig {
  apiKey: string;
  /** 改稿（1段目）のモデル */
  model: string;
  /** 解説（2段目）のモデル */
  explainModel: string;
  effort: AnthropicEffort;
}

/** 安全分類器に断られたとき、サーバー側で別モデルに引き継ぐ（fallbacks）を使うモデル */
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1']);

/** 事実確認1回で検索してよい回数の上限（費用の上限にもなる） */
const MAX_SEARCHES = 15;
/** サーバー側の検索が長引いて pause_turn で返ってきたとき、続きを頼む回数の上限 */
const MAX_FACT_CHECK_TURNS = 4;

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  readonly label = 'Claude（Anthropic API）';
  readonly sendsExternally = true;

  constructor(
    private readonly config: AnthropicConfig,
    private readonly clientFactory: (apiKey: string) => Anthropic = (apiKey) =>
      // 拡張機能のページから利用者自身のキーで直接呼ぶ（キーは利用者のブラウザーにだけ保存される）
      new Anthropic({ apiKey, dangerouslyAllowBrowser: true }),
  ) {}

  async availability(_targetLanguage: LanguageCode): Promise<ProviderAvailability> {
    if (!this.config.apiKey) {
      return { kind: 'unavailable', reason: M.errors.anthropicNoKey };
    }
    const granted = await chrome.permissions.contains({ origins: [ANTHROPIC_ORIGIN] });
    if (!granted) {
      return {
        kind: 'unavailable',
        reason: M.errors.anthropicNoPermission,
      };
    }
    return { kind: 'available' };
  }

  async rewrite(
    request: RewriteRequest,
    signal?: AbortSignal,
    onPartial?: (revisedText: string) => void,
  ): Promise<RewriteResult> {
    const notify = onPartial && distinct(onPartial, (t) => t);
    const { text: raw, usage } = await this.stream(
      this.config.model,
      REWRITE_SYSTEM_PROMPT,
      [{ role: 'user', content: buildRewritePrompt(request) }],
      rewriteJsonSchema(),
      signal,
      notify &&
        ((text) => {
          const partial = extractPartialStringField(text, 'revisedText');
          if (partial !== null) notify(partial);
        }),
    );
    return { ...parseRewriteOutput(raw), usage };
  }

  async explain(
    request: ExplainRequest,
    signal?: AbortSignal,
    onPartial?: (partial: PartialExplanation) => void,
  ): Promise<Explanation> {
    // システムプロンプト以外（手本の問答）を messages に並べる
    const fewShot = initialMessages('explain').filter(
      (m): m is { role: 'user' | 'assistant'; content: string } => m.role !== 'system',
    );
    const notify = onPartial && distinct(onPartial);
    const { text: raw, usage } = await this.stream(
      this.config.explainModel,
      EXPLAIN_SYSTEM_PROMPT,
      [...fewShot, { role: 'user', content: buildExplainPrompt(request) }],
      explainJsonSchema(request.reviewStructure),
      signal,
      notify &&
        ((text) => {
          const partial = extractPartialExplanation(text);
          if (partial) notify(partial);
        }),
    );
    return { ...parseExplainOutput(raw, request.sourceText, request.revisedText, request.reviewStructure), usage };
  }

  async chat(request: ChatRequest, signal?: AbortSignal, onPartial?: (reply: string) => void): Promise<ChatReply> {
    const notify = onPartial && distinct(onPartial, (t) => t);
    // 相談には判断力が要るので解説と同じモデルを使う
    const { text: raw, usage } = await this.stream(
      this.config.explainModel,
      buildChatSystemPrompt(request),
      chatHistoryMessages(request),
      chatJsonSchema(),
      signal,
      notify &&
        ((text) => {
          const partial = extractPartialStringField(text, 'reply');
          if (partial !== null) notify(partial);
        }),
    );
    return { ...parseChatOutput(raw, request.currentRevisedText), usage };
  }

  /**
   * 事実確認: Web 検索（サーバーツール）で調べさせ、結果は report_fact_check ツールの引数で受け取る。
   * 構造化出力は検索結果の引用（citations）と併用できないため、strict なツールで形を保証する。
   */
  async factCheck(
    request: FactCheckRequest,
    signal?: AbortSignal,
    onProgress?: (progress: FactCheckProgress) => void,
  ): Promise<FactCheckResult> {
    // 調べ方と判定には判断力が要るので解説と同じモデルを使う
    const model = this.config.explainModel;
    const client = this.clientFactory(this.config.apiKey);
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: buildFactCheckPrompt(request) }];
    const queries: string[] = [];
    const urls = new Set<string>();
    const total = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearches: 0 };
    let servedModel = model;
    try {
      for (let turn = 0; turn < MAX_FACT_CHECK_TURNS; turn++) {
        const stream = client.beta.messages.stream(
          {
            model,
            max_tokens: 64000,
            system: FACT_CHECK_SYSTEM_PROMPT,
            messages,
            tools: [
              { type: webSearchToolType(model), name: 'web_search', max_uses: MAX_SEARCHES },
              {
                name: FACT_CHECK_TOOL_NAME,
                description: 'Report the fact-check result. Call this exactly once, after searching.',
                input_schema: factCheckJsonSchema() as Anthropic.Beta.BetaTool.InputSchema,
                strict: true,
              },
            ],
            // 判定の質を優先して、改稿の設定（速さ優先）より深く考えさせる
            ...(supportsEffort(model) ? { output_config: { effort: 'medium' as const } } : {}),
            ...(FALLBACK_MODELS.has(model)
              ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
              : {}),
          },
          { signal },
        );

        // 検索語は入力の JSON が届き終わった時点で分かるので、それを途中経過として見せる
        const searching = new Map<number, string>();
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'server_tool_use') {
            if (event.content_block.name === 'web_search') searching.set(event.index, '');
          } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
            const partial = searching.get(event.index);
            if (partial !== undefined) searching.set(event.index, partial + event.delta.partial_json);
          } else if (event.type === 'content_block_stop') {
            const json = searching.get(event.index);
            searching.delete(event.index);
            const query = json === undefined ? null : searchQuery(json);
            if (query) {
              queries.push(query);
              onProgress?.({ queries: [...queries] });
            }
          }
        }

        const message = await stream.finalMessage();
        servedModel = message.model;
        total.input += message.usage.input_tokens;
        total.output += message.usage.output_tokens;
        total.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
        total.cacheRead += message.usage.cache_read_input_tokens ?? 0;
        total.webSearches += message.usage.server_tool_use?.web_search_requests ?? 0;
        for (const block of message.content) {
          if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
            for (const r of block.content) urls.add(normalizeUrl(r.url));
          }
        }

        if (message.stop_reason === 'refusal') throw new ProviderError(M.errors.claudeRefused);
        if (message.stop_reason === 'max_tokens') throw new ProviderError(M.errors.claudeMaxTokens);
        const report = message.content.find(
          (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === FACT_CHECK_TOOL_NAME,
        );
        if (report) {
          return {
            ...parseFactCheckOutput(report.input, request.sourceText, urls),
            queries,
            usage: {
              model: servedModel,
              inputTokens: total.input,
              outputTokens: total.output,
              webSearches: total.webSearches,
              costUsd: anthropicCostUsd(servedModel, total),
            },
          };
        }
        // サーバー側の検索が上限に達して一時停止した。そのまま送り返すと続きから再開する
        if (message.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: message.content });
      }
      throw new InvalidModelOutputError(M.errors.noFactCheck);
    } catch (e) {
      throw describeError(e);
    }
  }

  /** ストリーミングで問い合わせ、最終的なテキストと利用量を返す。onText: それまでに届いた全文 */
  private async stream(
    model: string,
    system: string,
    messages: Anthropic.Beta.BetaMessageParam[],
    schema: Record<string, unknown>,
    signal?: AbortSignal,
    onText?: (text: string) => void,
  ): Promise<{ text: string; usage: Usage }> {
    const client = this.clientFactory(this.config.apiKey);
    const stream = client.beta.messages.stream(
      {
        model,
        // 長い文章でも途中で切れないよう、ストリーミングで大きめに取る
        max_tokens: 64000,
        system,
        messages,
        output_config: {
          // Haiku 4.5 は effort を受け付けない
          ...(supportsEffort(model) ? { effort: this.config.effort } : {}),
          format: { type: 'json_schema', schema },
        },
        ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );

    let raw = '';
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'fallback') {
          // 途中で別モデルに引き継がれたら、それまでの出力は捨てる
          raw = '';
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          raw += event.delta.text;
          onText?.(raw);
        }
      }
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') {
        throw new ProviderError(M.errors.claudeRefused);
      }
      if (message.stop_reason === 'max_tokens') {
        throw new ProviderError(M.errors.claudeMaxTokens);
      }
      return { text: finalText(message.content), usage: toUsage(message.model, message.usage) };
    } catch (e) {
      throw describeError(e);
    }
  }
}

function toUsage(model: string, u: Anthropic.Beta.BetaUsage): Usage {
  return {
    model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    costUsd: anthropicCostUsd(model, {
      input: u.input_tokens,
      output: u.output_tokens,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    }),
  };
}

export function supportsEffort(model: string): boolean {
  return !model.startsWith('claude-haiku-');
}

/** 検索結果を絞り込む版（dynamic filtering）は Haiku では使えない */
export function webSearchToolType(model: string): 'web_search_20250305' | 'web_search_20260209' {
  return model.startsWith('claude-haiku-') ? 'web_search_20250305' : 'web_search_20260209';
}

/** web_search の入力 JSON から検索語を取り出す */
function searchQuery(json: string): string | null {
  try {
    const query = (JSON.parse(json) as { query?: unknown }).query;
    return typeof query === 'string' && query.trim() !== '' ? query.trim() : null;
  } catch {
    return null;
  }
}

/** 最後の fallback ブロック以降のテキストを連結する（引き継ぎ前の出力を含めない） */
function finalText(content: Anthropic.Beta.BetaContentBlock[]): string {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback');
  return content
    .slice(lastFallback + 1)
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function describeError(e: unknown): unknown {
  if (e instanceof Anthropic.AuthenticationError) {
    return new ProviderError(M.errors.anthropicInvalidKey);
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError(M.errors.anthropicModelDenied(e.message));
  }
  if (e instanceof Anthropic.NotFoundError) {
    return new ProviderError(M.errors.anthropicModelNotFound);
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new ProviderError(M.errors.anthropicRateLimit);
  }
  if (e instanceof Anthropic.APIUserAbortError) {
    return new DOMException('aborted', 'AbortError');
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ProviderError(M.errors.anthropicConnection);
  }
  if (e instanceof Anthropic.APIError) {
    return new ProviderError(M.errors.anthropicError(String(e.status ?? M.errors.unknownStatus), e.message));
  }
  return e;
}
