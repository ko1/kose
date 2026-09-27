import type {
  ChatReply,
  ChatRequest,
  Explanation,
  ExplainRequest,
  LanguageCode,
  RewriteRequest,
  RewriteResult,
} from '../domain/types';
import { countChars } from '../domain/text';
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

export const OPENAI_ORIGIN = 'https://api.openai.com/*';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  maxInputChars: number;
}

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const;
  readonly label = 'OpenAI API';
  readonly sendsExternally = true;

  constructor(
    private readonly config: OpenAIConfig,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async availability(_targetLanguage: LanguageCode): Promise<ProviderAvailability> {
    if (!this.config.apiKey) {
      return { kind: 'unavailable', reason: 'OpenAI APIキーが設定されていません。設定画面で入力してください。' };
    }
    const granted = await chrome.permissions.contains({ origins: [OPENAI_ORIGIN] });
    if (!granted) {
      return {
        kind: 'unavailable',
        reason: 'api.openai.com への接続が許可されていません。設定画面でOpenAIを選び直して許可してください。',
      };
    }
    return { kind: 'available' };
  }

  async checkInput(request: RewriteRequest): Promise<InputCheck> {
    return countChars(request.sourceText) > this.config.maxInputChars
      ? { ok: false, limit: this.config.maxInputChars, unit: 'chars' }
      : { ok: true };
  }

  async rewrite(request: RewriteRequest, signal?: AbortSignal): Promise<RewriteResult> {
    const messages = [...initialMessages('rewrite'), { role: 'user' as const, content: buildRewritePrompt(request) }];
    return parseRewriteOutput(await this.complete(messages, 'rewrite_result', rewriteJsonSchema(), signal));
  }

  async explain(request: ExplainRequest, signal?: AbortSignal): Promise<Explanation> {
    const messages = [...initialMessages('explain'), { role: 'user' as const, content: buildExplainPrompt(request) }];
    const raw = await this.complete(messages, 'explanation', explainJsonSchema(), signal);
    return parseExplainOutput(raw, request.sourceText, request.revisedText);
  }

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatReply> {
    const messages: PromptMessage[] = [
      { role: 'system', content: buildChatSystemPrompt(request) },
      ...chatHistoryMessages(request),
    ];
    const raw = await this.complete(messages, 'chat_reply', chatJsonSchema(), signal);
    return parseChatOutput(raw, request.currentRevisedText);
  }

  private async complete(
    messages: PromptMessage[],
    schemaName: string,
    schema: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await this.fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
      }),
      signal,
    });
    if (!res.ok) throw new ProviderError(await describeHttpError(res));

    const body = (await res.json()) as {
      choices?: { message?: { content?: string | null; refusal?: string | null } }[];
    };
    const message = body.choices?.[0]?.message;
    if (message?.refusal) throw new ProviderError(`AIが処理を断りました: ${message.refusal}`);
    if (!message?.content) throw new ProviderError('AIの応答が空でした。');
    return message.content;
  }
}

async function describeHttpError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    // 本文がJSONでなければ詳細なし
  }
  switch (res.status) {
    case 401:
      return 'OpenAI APIキーが無効です。設定画面で確認してください。';
    case 429:
      return `OpenAI APIの利用上限に達したか、混雑しています。${detail}`;
    default:
      return `OpenAI APIエラー (${res.status}) ${detail}`.trim();
  }
}
