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
import { appendChunk, distinct, extractPartialExplanation, extractPartialStringField } from './partialJson';
import {
  buildChatSystemPrompt,
  buildExplainPrompt,
  buildRewritePrompt,
  chatHistoryMessages,
  initialMessages,
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

/** measureInputUsage が使えない環境での文字数上限 */
const FALLBACK_MAX_CHARS = 2000;

function api(): LanguageModelStatic | undefined {
  return globalThis.LanguageModel;
}

/** 解説は常に日本語なので、出力言語には常に ja を含める */
export function languageOptions(targetLanguage: LanguageCode): LanguageModelOptions {
  const outputs = targetLanguage === 'ja' ? ['ja'] : [targetLanguage, 'ja'];
  return {
    expectedInputs: [{ type: 'text', languages: ['ja', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: outputs }],
  };
}

export class BuiltinProvider implements AIProvider {
  readonly id = 'builtin' as const;
  readonly label = 'ローカル（Chrome内蔵AI）';
  readonly sendsExternally = false;

  async availability(targetLanguage: LanguageCode): Promise<ProviderAvailability> {
    const lm = api();
    if (!lm) {
      return {
        kind: 'unavailable',
        reason: 'このChromeではBuilt-in AI（Prompt API）が利用できません。Chromeのバージョンと動作要件を確認してください。',
      };
    }
    let state: LanguageModelAvailability;
    try {
      state = await lm.availability(languageOptions(targetLanguage));
    } catch (e) {
      return { kind: 'unavailable', reason: `Built-in AIの利用可否を確認できませんでした: ${errorMessage(e)}` };
    }
    switch (state) {
      case 'available':
        return { kind: 'available' };
      case 'downloadable':
        return { kind: 'needs-download' };
      case 'downloading':
        return { kind: 'downloading' };
      default:
        return {
          kind: 'unavailable',
          reason:
            'この環境・言語の組み合わせではChrome内蔵AIを利用できません（ハードウェア要件、空き容量、対応言語などが原因の可能性があります）。',
        };
    }
  }

  async prepare(targetLanguage: LanguageCode, onProgress: (ratio: number) => void): Promise<void> {
    const lm = api();
    if (!lm) throw new ProviderError('Built-in AIが利用できません。');
    const session = await lm.create({
      ...languageOptions(targetLanguage),
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => onProgress(e.total ? e.loaded / e.total : e.loaded));
      },
    });
    session.destroy();
  }

  async checkInput(request: RewriteRequest): Promise<InputCheck> {
    const lm = api();
    if (!lm) return { ok: true };
    const base = await baseSession(lm, 'rewrite', request.targetLanguage);
    const measure = base.measureInputUsage ?? base.measureContextUsage;
    const quota = base.inputQuota ?? base.contextWindow;
    const used = base.inputUsage ?? base.contextUsage ?? 0;
    if (!measure || quota === undefined) {
      return [...request.sourceText].length > FALLBACK_MAX_CHARS
        ? { ok: false, limit: FALLBACK_MAX_CHARS, unit: 'chars' }
        : { ok: true };
    }
    const needed = await measure.call(base, buildRewritePrompt(request), {
      responseConstraint: rewriteJsonSchema(),
    });
    // 出力分の余裕として入力と同程度を見込む
    return used + needed * 2 > quota ? { ok: false, limit: quota, unit: 'tokens' } : { ok: true };
  }

  async prewarm(targetLanguage: LanguageCode): Promise<void> {
    const lm = api();
    if (!lm || (await lm.availability(languageOptions(targetLanguage))) !== 'available') return;
    await baseSession(lm, 'rewrite', targetLanguage);
  }

  async rewrite(
    request: RewriteRequest,
    signal?: AbortSignal,
    onPartial?: (revisedText: string) => void,
  ): Promise<RewriteResult> {
    const lm = requireApi();
    // システムプロンプト読み込み済みのセッションを複製して使う（毎回の読み込みを省く）。
    // 複製は元の会話履歴を持たないので、他のレビューの文脈は混ざらない
    const session = await forkSession(lm, 'rewrite', request.targetLanguage, signal);
    try {
      const input = buildRewritePrompt(request);
      const options = { responseConstraint: rewriteJsonSchema(), signal };
      const notify = onPartial && distinct(onPartial, (t) => t);
      const raw =
        notify && session.promptStreaming
          ? await readStream(session.promptStreaming(input, options), (text) => {
              const partial = extractPartialStringField(text, 'revisedText');
              if (partial !== null) notify(partial);
            })
          : await session.prompt(input, options);
      return parseRewriteOutput(raw);
    } finally {
      session.destroy();
    }
  }

  async explain(
    request: ExplainRequest,
    signal?: AbortSignal,
    onPartial?: (partial: PartialExplanation) => void,
  ): Promise<Explanation> {
    const lm = requireApi();
    const session = await forkSession(lm, 'explain', request.targetLanguage, signal);
    try {
      const input = buildExplainPrompt(request);
      const options = { responseConstraint: explainJsonSchema(), signal };
      const notify = onPartial && distinct(onPartial);
      const raw =
        notify && session.promptStreaming
          ? await readStream(session.promptStreaming(input, options), (text) => {
              const partial = extractPartialExplanation(text);
              if (partial) notify(partial);
            })
          : await session.prompt(input, options);
      return parseExplainOutput(raw, request.sourceText, request.revisedText);
    } finally {
      session.destroy();
    }
  }

  async chat(request: ChatRequest, signal?: AbortSignal, onPartial?: (replyJa: string) => void): Promise<ChatReply> {
    const lm = requireApi();
    const system = buildChatSystemPrompt(request);
    const messages = chatHistoryMessages(request);
    const message = messages.pop()!;
    let history = messages;
    // コンテキストが小さいので、入りきらなければ古い発言から削る（原文・表示中の案・今回の発言は必ず残す）
    for (;;) {
      const session = await lm.create({
        ...languageOptions(request.targetLanguage),
        initialPrompts: [{ role: 'system', content: system }, ...history],
        signal,
      });
      try {
        const options = { responseConstraint: chatJsonSchema(), signal };
        if (!(await fitsInContext(session, message.content, options))) {
          if (history.length === 0) {
            throw new ProviderError('相談の内容が長すぎて、Chrome内蔵AIでは処理できません。');
          }
          history = history.slice(2); // user と assistant の1往復ずつ削る
          continue;
        }
        const notify = onPartial && distinct(onPartial, (t) => t);
        const raw =
          notify && session.promptStreaming
            ? await readStream(session.promptStreaming(message.content, options), (text) => {
                const partial = extractPartialStringField(text, 'replyJa');
                if (partial !== null) notify(partial);
              })
            : await session.prompt(message.content, options);
        return parseChatOutput(raw, request.currentRevisedText);
      } finally {
        session.destroy();
      }
    }
  }
}

function requireApi(): LanguageModelStatic {
  const lm = api();
  if (!lm) throw new ProviderError('Built-in AIが利用できません。');
  return lm;
}

type SessionKind = 'rewrite' | 'explain';

/** システムプロンプト（と手本）だけを読み込んだセッション。段・出力言語ごとに1つ保持し、直接 prompt はしない */
const baseSessions = new Map<string, Promise<LanguageModelSession>>();

function createSession(lm: LanguageModelStatic, kind: SessionKind, targetLanguage: LanguageCode, signal?: AbortSignal) {
  return lm.create({ ...languageOptions(targetLanguage), initialPrompts: initialMessages(kind), signal });
}

function baseSession(lm: LanguageModelStatic, kind: SessionKind, targetLanguage: LanguageCode): Promise<LanguageModelSession> {
  const key = `${kind}:${targetLanguage}`;
  let base = baseSessions.get(key);
  if (!base) {
    base = createSession(lm, kind, targetLanguage);
    baseSessions.set(key, base);
    base.catch(() => baseSessions.delete(key));
  }
  return base;
}

async function forkSession(
  lm: LanguageModelStatic,
  kind: SessionKind,
  targetLanguage: LanguageCode,
  signal?: AbortSignal,
): Promise<LanguageModelSession> {
  const base = await baseSession(lm, kind, targetLanguage);
  if (!base.clone) return createSession(lm, kind, targetLanguage, signal);
  try {
    return await base.clone({ signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    // 保持していたセッションが使えなくなっていたら作り直す
    baseSessions.delete(`${kind}:${targetLanguage}`);
    base.destroy();
    const fresh = await baseSession(lm, kind, targetLanguage);
    return fresh.clone!({ signal });
  }
}

/** 入力と、出力分の余裕（入力と同程度）がコンテキストに収まるか。計測APIが無ければ収まるとみなす */
async function fitsInContext(
  session: LanguageModelSession,
  input: string,
  options: LanguageModelPromptOptions,
): Promise<boolean> {
  const measure = session.measureInputUsage ?? session.measureContextUsage;
  const quota = session.inputQuota ?? session.contextWindow;
  if (!measure || quota === undefined) return true;
  const used = session.inputUsage ?? session.contextUsage ?? 0;
  return used + (await measure.call(session, input, options)) * 2 <= quota;
}

/** ストリームを読み切りつつ、それまでに届いた全文を通知する */
async function readStream(stream: ReadableStream<string>, onText: (text: string) => void): Promise<string> {
  const reader = stream.getReader();
  let raw = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return raw;
    raw = appendChunk(raw, value);
    onText(raw);
  }
}

/** テスト用 */
export function resetBuiltinSessions(): void {
  baseSessions.clear();
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
