import Anthropic from '@anthropic-ai/sdk';
import { M } from '../shared/messages';
import type {
  ChatReply,
  ChatRequest,
  Explanation,
  ExplainRequest,
  LanguageCode,
  PartialExplanation,
  RewriteRequest,
  RewriteResult,
  Usage,
} from '../domain/types';
import { countChars } from '../domain/text';
import { distinct, extractPartialExplanation, extractPartialStringField } from './partialJson';
import { anthropicCostUsd } from './pricing';
import {
  buildChatSystemPrompt,
  buildExplainPrompt,
  buildRewritePrompt,
  chatHistoryMessages,
  EXPLAIN_SYSTEM_PROMPT,
  initialMessages,
  REWRITE_SYSTEM_PROMPT,
} from './prompts';
import { AIProvider, InputCheck, ProviderAvailability, ProviderError } from './provider';
import {
  chatJsonSchema,
  explainJsonSchema,
  parseChatOutput,
  parseExplainOutput,
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
  maxInputChars: number;
}

/** 安全分類器に断られたとき、サーバー側で別モデルに引き継ぐ（fallbacks）を使うモデル */
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1']);

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

  async checkInput(request: RewriteRequest): Promise<InputCheck> {
    return countChars(request.sourceText) > this.config.maxInputChars
      ? { ok: false, limit: this.config.maxInputChars, unit: 'chars' }
      : { ok: true };
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
        max_tokens: 16000,
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
