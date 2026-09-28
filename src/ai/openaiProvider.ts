import type {
  ChatReply,
  ChatRequest,
  Explanation,
  ExplainRequest,
  LanguageCode,
  RewriteRequest,
  RewriteResult,
  Usage,
} from '../domain/types';
import { countChars } from '../domain/text';
import { DEFAULT_OLLAMA_URL } from '../storage/settings';
import { M } from '../shared/messages';
import {
  buildChatSystemPrompt,
  buildExplainPrompt,
  buildRewritePrompt,
  chatHistoryMessages,
  initialMessages,
  PromptMessage,
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

/**
 * OpenAI 互換の Chat Completions API（/chat/completions）を持つプロバイダー。
 * OpenAI・Gemini・OpenRouter・Ollama の違い（接続先、キーの要否、追加のヘッダー・本文）は CompatibleSpec で表す。
 */
export type CompatibleProviderId = 'openai' | 'gemini' | 'openrouter' | 'ollama';

export interface CompatibleSpec {
  id: CompatibleProviderId;
  /** 表示名（エラーメッセージなど） */
  name: string;
  /** 表示用のホスト名 */
  host: string;
  /** 接続の許可（optional_host_permissions）に使うパターン */
  origin: string;
  endpoint: string;
  requiresKey: boolean;
  /** 端末の外へ送るか（Ollama は自分のパソコンの中なので送らない） */
  sendsExternally: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export const OPENAI_ORIGIN = 'https://api.openai.com/*';
export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com/*';
export const OPENROUTER_ORIGIN = 'https://openrouter.ai/*';

export const OPENAI_SPEC: CompatibleSpec = {
  id: 'openai',
  name: 'OpenAI',
  host: 'api.openai.com',
  origin: OPENAI_ORIGIN,
  endpoint: 'https://api.openai.com/v1/chat/completions',
  requiresKey: true,
  sendsExternally: true,
};

export const GEMINI_SPEC: CompatibleSpec = {
  id: 'gemini',
  name: 'Gemini',
  host: 'generativelanguage.googleapis.com',
  origin: GEMINI_ORIGIN,
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  requiresKey: true,
  sendsExternally: true,
};

export const OPENROUTER_SPEC: CompatibleSpec = {
  id: 'openrouter',
  name: 'OpenRouter',
  host: 'openrouter.ai',
  origin: OPENROUTER_ORIGIN,
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  requiresKey: true,
  sendsExternally: true,
  // OpenRouter のアプリ一覧での表示名
  extraHeaders: { 'HTTP-Referer': 'https://github.com/ko1/kose', 'X-Title': 'kose' },
  extraBody: {
    // 構造化出力に対応する接続先にだけ振り分ける。料金も応答に含めてもらう
    provider: { require_parameters: true },
    usage: { include: true },
  },
};

/** Ollama（自分のパソコンで動くローカルAI）。baseUrl は http://localhost:11434 など */
export function ollamaSpec(baseUrl: string): CompatibleSpec {
  const url = safeUrl(baseUrl);
  return {
    id: 'ollama',
    name: 'Ollama',
    host: url.host,
    origin: `${url.protocol}//${url.hostname}/*`,
    endpoint: `${url.origin}/v1/chat/completions`,
    requiresKey: false,
    sendsExternally: false,
  };
}

function safeUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    return new URL(DEFAULT_OLLAMA_URL);
  }
}

export interface CompatibleConfig {
  apiKey: string;
  model: string;
  maxInputChars: number;
}

/** JSON Schema による構造化出力に対応していなかった接続先とモデル。以後は JSON モードで問い合わせる */
const schemaUnsupported = new Set<string>();

export function resetSchemaSupport(): void {
  schemaUnsupported.clear();
}

type CompletionBody = {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: CompatibleProviderId;
  readonly label: string;
  readonly sendsExternally: boolean;

  constructor(
    private readonly spec: CompatibleSpec,
    private readonly config: CompatibleConfig,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {
    this.id = spec.id;
    this.label = spec.name;
    this.sendsExternally = spec.sendsExternally;
  }

  async availability(_targetLanguage: LanguageCode): Promise<ProviderAvailability> {
    if (this.spec.requiresKey && !this.config.apiKey) {
      return { kind: 'unavailable', reason: M.errors.noKey(this.spec.name) };
    }
    const granted = await chrome.permissions.contains({ origins: [this.spec.origin] });
    if (!granted) return { kind: 'unavailable', reason: M.errors.noPermission(this.spec.host, this.spec.name) };
    return { kind: 'available' };
  }

  async checkInput(request: RewriteRequest): Promise<InputCheck> {
    return countChars(request.sourceText) > this.config.maxInputChars
      ? { ok: false, limit: this.config.maxInputChars, unit: 'chars' }
      : { ok: true };
  }

  async rewrite(request: RewriteRequest, signal?: AbortSignal): Promise<RewriteResult> {
    const messages = [...initialMessages('rewrite'), { role: 'user' as const, content: buildRewritePrompt(request) }];
    const { text, usage } = await this.complete(messages, 'rewrite_result', rewriteJsonSchema(), signal);
    return { ...parseRewriteOutput(text), usage };
  }

  async explain(request: ExplainRequest, signal?: AbortSignal): Promise<Explanation> {
    const messages = [...initialMessages('explain'), { role: 'user' as const, content: buildExplainPrompt(request) }];
    const { text, usage } = await this.complete(
      messages,
      'explanation',
      explainJsonSchema(request.reviewStructure),
      signal,
    );
    return { ...parseExplainOutput(text, request.sourceText, request.revisedText, request.reviewStructure), usage };
  }

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatReply> {
    const messages: PromptMessage[] = [
      { role: 'system', content: buildChatSystemPrompt(request) },
      ...chatHistoryMessages(request),
    ];
    const { text, usage } = await this.complete(messages, 'chat_reply', chatJsonSchema(), signal);
    return { ...parseChatOutput(text, request.currentRevisedText), usage };
  }

  private async complete(
    messages: PromptMessage[],
    schemaName: string,
    schema: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ text: string; usage: Usage }> {
    const key = `${this.spec.endpoint}|${this.config.model}`;
    const withSchema = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
    let res = await this.post(messages, schemaUnsupported.has(key) ? { type: 'json_object' } : withSchema, signal);
    // JSON Schema の一部に対応していない接続先・モデルもある。JSON モードで1回だけやり直す
    // （出力の項目はプロンプトに書いてあり、受け取った後にスキーマで検証する）
    if ((res.status === 400 || res.status === 404) && !schemaUnsupported.has(key)) {
      const retry = await this.post(messages, { type: 'json_object' }, signal);
      if (retry.ok) schemaUnsupported.add(key);
      res = retry;
    }
    if (!res.ok) throw new ProviderError(await this.describeHttpError(res));

    const body = (await res.json()) as CompletionBody;
    const message = body.choices?.[0]?.message;
    if (message?.refusal) throw new ProviderError(M.errors.refused(message.refusal));
    if (!message?.content) throw new ProviderError(M.errors.empty);
    return {
      text: message.content,
      usage: {
        model: body.model ?? this.config.model,
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        // OpenRouter は料金（USD）を返す
        costUsd: typeof body.usage?.cost === 'number' ? body.usage.cost : undefined,
      },
    };
  }

  private async post(
    messages: PromptMessage[],
    responseFormat: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(this.spec.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
          ...this.spec.extraHeaders,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          response_format: responseFormat,
          ...this.spec.extraBody,
        }),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ProviderError(M.errors.connectFailed(this.spec.name, this.spec.host, this.spec.id === 'ollama'));
    }
  }

  private async describeHttpError(res: Response): Promise<string> {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } | string };
      detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? '');
    } catch {
      // 本文がJSONでなければ詳細なし
    }
    const { name } = this.spec;
    if (this.spec.id === 'ollama' && res.status === 403) return M.errors.ollamaForbidden;
    switch (res.status) {
      case 401:
        return M.errors.invalidKey(name);
      case 402:
        return M.errors.noCredits(name, detail);
      case 429:
        return M.errors.rateLimit(name, detail);
      default:
        return M.errors.httpError(name, res.status, detail);
    }
  }
}
