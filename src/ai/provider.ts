import type {
  ChatReply,
  ChatRequest,
  Explanation,
  ExplainRequest,
  LanguageCode,
  PartialExplanation,
  RewriteRequest,
  RewriteResult,
} from '../domain/types';

export type ProviderId = 'builtin' | 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama';

export type ProviderAvailability =
  | { kind: 'available' }
  /** Chrome内蔵モデルが未ダウンロード。ユーザー操作で prepare() を呼ぶ必要がある */
  | { kind: 'needs-download' }
  | { kind: 'downloading' }
  | { kind: 'unavailable'; reason: string };

export type InputCheck = { ok: true } | { ok: false; limit: number; unit: 'chars' | 'tokens' };

export interface AIProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** クラウドへ外部送信するか（UIで明示する。解説を自動で生成するかの既定にも使う） */
  readonly sendsExternally: boolean;
  availability(targetLanguage: LanguageCode): Promise<ProviderAvailability>;
  checkInput(request: RewriteRequest): Promise<InputCheck>;
  /** 1段目: 改稿文だけを生成する。onPartial: 生成途中の改稿文（対応するプロバイダーのみ呼ぶ） */
  rewrite(
    request: RewriteRequest,
    signal?: AbortSignal,
    onPartial?: (revisedText: string) => void,
  ): Promise<RewriteResult>;
  /** 2段目: 原文と改稿文から解説を生成する。onPartial: 生成途中の解説（対応するプロバイダーのみ呼ぶ） */
  explain(
    request: ExplainRequest,
    signal?: AbortSignal,
    onPartial?: (partial: PartialExplanation) => void,
  ): Promise<Explanation>;
  /** 右クリック前に準備を済ませておく（モデルのダウンロードは始めない）。失敗しても無視してよい */
  prewarm?(targetLanguage: LanguageCode): Promise<void>;
  /** モデルのダウンロードなど。ユーザー操作（クリック）の中で呼ぶこと */
  prepare?(targetLanguage: LanguageCode, onProgress: (ratio: number) => void): Promise<void>;
  /** ニュアンス相談。onPartial: 生成途中の返答（対応するプロバイダーのみ呼ぶ） */
  chat(request: ChatRequest, signal?: AbortSignal, onPartial?: (reply: string) => void): Promise<ChatReply>;
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}
