import Anthropic from '@anthropic-ai/sdk';
import { M } from '../shared/messages';
import type {
  ChatReply,
  ChatRequest,
  ClaimProgress,
  Explanation,
  ExplainRequest,
  FactCheckProgress,
  FactCheckRequest,
  LanguageCode,
  SearchPhase,
  SearchProgress,
  SearchStep,
  PartialExplanation,
  RewriteRequest,
  RewriteResult,
  Usage,
} from '../domain/types';
import { distinct, extractPartialExplanation, extractPartialStringField, parsePartialJson } from './partialJson';
import { anthropicCostUsd } from './pricing';
import {
  buildChatSystemPrompt,
  CHAT_TOOL_NAME,
  buildExplainPrompt,
  buildRewritePrompt,
  chatHistoryMessages,
  EXPLAIN_SYSTEM_PROMPT,
  buildClaimCheckPrompt,
  buildFactCheckPrompt,
  buildFactSummaryPrompt,
  CLAIM_CHECK_SYSTEM_PROMPT,
  CLAIM_CHECK_TOOL_NAME,
  FACT_CLAIMS_SYSTEM_PROMPT,
  FACT_SUMMARY_SYSTEM_PROMPT,
  initialMessages,
  REWRITE_SYSTEM_PROMPT,
} from './prompts';
import { AIProvider, FactCheckResult, ProviderAvailability, ProviderError } from './provider';
import {
  chatJsonSchema,
  chatWithSourcesJsonSchema,
  claimVerdictJsonSchema,
  explainJsonSchema,
  factClaimsJsonSchema,
  factSummaryJsonSchema,
  InvalidModelOutputError,
  normalizeUrl,
  parseChatOutput,
  parseChatWithSourcesOutput,
  parseClaimVerdictOutput,
  parseExplainOutput,
  parseFactClaimsOutput,
  parseFactSummaryOutput,
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

/**
 * 事実確認で主張1件につき検索してよい回数の上限。品質を優先して、必要なだけ調べられるよう多めに取る
 * （判定が固まれば、上限より前にやめる）
 */
const MAX_CLAIM_SEARCHES = 10;
/** 事実確認で同時に確かめる主張の数（API のレート制限に当たらない程度） */
const CLAIM_CONCURRENCY = 4;
/** 相談1回で検索してよい回数の上限 */
const MAX_CHAT_SEARCHES = 10;
/** サーバー側の検索が長引いて pause_turn で返ってきたとき、続きを頼む回数の上限 */
const MAX_SEARCH_TURNS = 8;

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

  async chat(
    request: ChatRequest,
    signal?: AbortSignal,
    onPartial?: (reply: string) => void,
    onSearch?: (progress: SearchProgress) => void,
  ): Promise<ChatReply> {
    const notify = onPartial && distinct(onPartial, (t) => t);
    const onReply =
      notify &&
      ((text: string) => {
        const partial = extractPartialStringField(text, 'reply');
        if (partial !== null) notify(partial);
      });
    // 相談には判断力が要るので解説と同じモデルを使う
    if (request.webSearch) {
      const { input, urls, usage } = await this.searchAndReport({
        model: this.config.explainModel,
        system: buildChatSystemPrompt(request),
        messages: chatHistoryMessages(request),
        tool: { name: CHAT_TOOL_NAME, description: 'Report your reply to the user. Call this exactly once.', schema: chatWithSourcesJsonSchema() },
        maxSearches: MAX_CHAT_SEARCHES,
        effort: this.config.effort,
        signal,
        onProgress: onSearch,
        onReportJson: onReply,
      });
      // 事実確認で示した出典も、相談の出典として認める
      for (const c of request.factCheck?.claims ?? []) for (const s of c.sources) urls.add(normalizeUrl(s.url));
      return { ...parseChatWithSourcesOutput(input, request.currentRevisedText, urls), usage };
    }
    const { text: raw, usage } = await this.stream(
      this.config.explainModel,
      buildChatSystemPrompt(request),
      chatHistoryMessages(request),
      chatJsonSchema(),
      signal,
      onReply,
    );
    return { ...parseChatOutput(raw, request.currentRevisedText), usage };
  }

  /**
   * 事実確認: 主張を抜き出し、主張ごとに Web 検索で確かめ（並べて実行）、全体の評価をまとめる。
   * 1件ずつ別の問い合わせにして必要なだけ検索させ、待ち時間は一番長くかかった1件ぶんに抑える
   */
  async factCheck(
    request: FactCheckRequest,
    signal?: AbortSignal,
    onProgress?: (progress: FactCheckProgress) => void,
  ): Promise<FactCheckResult> {
    // 調べ方と判定には判断力が要るので解説と同じモデルを使い、改稿の設定（速さ優先）より深く考えさせる
    const model = this.config.explainModel;
    const context = buildFactCheckPrompt(request);
    const progress: FactCheckProgress = { stage: 'extracting', claims: [] };
    const notify = () => onProgress?.({ ...progress, claims: [...progress.claims] });
    notify();
    const usages: Usage[] = [];

    // 1. 確かめる主張を抜き出す。書き出し途中から一覧に出す
    const extracted = await this.stream(
      model,
      FACT_CLAIMS_SYSTEM_PROMPT,
      [{ role: 'user', content: context }],
      factClaimsJsonSchema(),
      signal,
      onProgress &&
        ((text) => {
          const claims = (parsePartialJson(text) as { claims?: unknown } | null)?.claims;
          if (!Array.isArray(claims)) return;
          progress.claims = claims
            .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
            .map((c) => ({ status: 'waiting', quote: stringOr(c.quote), claim: stringOr(c.claim) }));
          notify();
        }),
      'medium',
    );
    usages.push(extracted.usage);
    const targets = parseFactClaimsOutput(extracted.text, request.sourceText);
    progress.stage = 'checking';
    progress.claims = targets.map((t) => ({ ...t, status: 'waiting' }));
    notify();
    if (targets.length === 0) return { summary: '', claims: [], queries: [], usage: sumUsage(usages) };

    // 2. 主張ごとに確かめる。原文の部分はどの主張でも同じなのでキャッシュさせる
    const queries: string[][] = targets.map(() => []);
    const errors: unknown[] = [];
    const claims = await mapConcurrently(targets, CLAIM_CONCURRENCY, async (target, i) => {
      const set = (p: ClaimProgress) => {
        progress.claims[i] = p;
        notify();
      };
      try {
        const { input, urls, queries: q, usage } = await this.searchAndReport({
          model,
          system: CLAIM_CHECK_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
                { type: 'text', text: buildClaimCheckPrompt(target) },
              ],
            },
          ],
          tool: {
            name: CLAIM_CHECK_TOOL_NAME,
            description: 'Report the verdict on the claim. Call this exactly once, after searching.',
            schema: claimVerdictJsonSchema(),
          },
          maxSearches: MAX_CLAIM_SEARCHES,
          effort: 'high',
          signal,
          onProgress: (search) => set({ ...target, status: 'checking', search }),
        });
        usages.push(usage);
        queries[i] = q;
        const result = parseClaimVerdictOutput(input, target, urls);
        set({ ...target, status: 'done', result });
        return result;
      } catch (e) {
        if (signal?.aborted) throw e;
        // 1件の失敗で全体を捨てず、その主張だけ「確認できず」にする
        errors.push(e);
        const message = e instanceof Error ? e.message : String(e);
        set({ ...target, status: 'failed', message });
        return { ...target, verdict: 'unverified' as const, explanation: M.factCheck.claimFailed(message), sources: [] };
      }
    });
    // 全部失敗したなら（キーや通信の問題など）、事実確認そのものの失敗とする
    if (errors.length === targets.length) throw errors[0];

    // 3. 全体の評価をまとめる
    progress.stage = 'summarizing';
    notify();
    const summary = await this.stream(
      model,
      FACT_SUMMARY_SYSTEM_PROMPT,
      [{ role: 'user', content: `${context}\n\n${buildFactSummaryPrompt(claims)}` }],
      factSummaryJsonSchema(),
      signal,
      onProgress &&
        ((text) => {
          const partial = extractPartialStringField(text, 'summary');
          if (partial === null || partial === progress.summary) return;
          progress.summary = partial;
          notify();
        }),
      'low',
    );
    usages.push(summary.usage);
    return { summary: parseFactSummaryOutput(summary.text), claims, queries: queries.flat(), usage: sumUsage(usages) };
  }

  /**
   * Web 検索（サーバーツール）つきで問い合わせ、結果は strict なクライアントツールの引数で受け取る。
   * 構造化出力は検索結果の引用（citations）と併用できないため、ツールで形を保証する。
   * onProgress: 段階や検索の経過が変わるたびに。onReportJson: 生成途中のツール引数（JSON）
   */
  private async searchAndReport(opts: {
    model: string;
    system: string;
    messages: Anthropic.Beta.BetaMessageParam[];
    tool: { name: string; description: string; schema: Record<string, unknown> };
    maxSearches: number;
    effort: AnthropicEffort;
    signal?: AbortSignal;
    onProgress?: (progress: SearchProgress) => void;
    onReportJson?: (json: string) => void;
  }): Promise<{ input: unknown; urls: Set<string>; queries: string[]; usage: Usage }> {
    const { model, tool } = opts;
    const client = this.clientFactory(this.config.apiKey);
    const messages = [...opts.messages];
    // 検索ごとの経過。id は server_tool_use のもので、結果（web_search_tool_result）と結びつける
    const steps: (SearchStep & { id: string })[] = [];
    let phase: SearchPhase = 'starting';
    const progress = () =>
      opts.onProgress?.({ phase, searches: steps.map(({ id: _id, ...step }) => ({ ...step })) });
    progress();
    const urls = new Set<string>();
    const total = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearches: 0 };
    try {
      for (let turn = 0; turn < MAX_SEARCH_TURNS; turn++) {
        const stream = client.beta.messages.stream(
          {
            model,
            max_tokens: 64000,
            system: opts.system,
            messages,
            tools: [
              { type: webSearchToolType(model), name: 'web_search', max_uses: opts.maxSearches },
              {
                name: tool.name,
                description: tool.description,
                input_schema: tool.schema as Anthropic.Beta.BetaTool.InputSchema,
                strict: true,
              },
            ],
            ...(supportsEffort(model) ? { output_config: { effort: opts.effort } } : {}),
            ...(FALLBACK_MODELS.has(model)
              ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
              : {}),
          },
          { signal: opts.signal },
        );

        // 検索語（入力の JSON）と結果のツール引数は、届くたびに知らせる
        const searching = new Map<number, { step: SearchStep; json: string }>();
        const reporting = new Map<number, string>();
        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            const block = event.content_block;
            if (block.type === 'server_tool_use' && block.name === 'web_search') {
              const step = { id: block.id, query: '' };
              steps.push(step);
              searching.set(event.index, { step, json: '' });
              phase = 'searching';
              progress();
            } else if (block.type === 'web_search_tool_result') {
              const step = steps.find((s) => s.id === block.tool_use_id);
              if (step) {
                step.results = Array.isArray(block.content)
                  ? block.content.map((r) => ({ title: r.title, url: r.url }))
                  : [];
              }
              phase = 'reading';
              progress();
            } else if (block.type === 'tool_use' && block.name === tool.name) {
              reporting.set(event.index, '');
              phase = 'writing';
              progress();
            }
          } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
            const search = searching.get(event.index);
            if (search) {
              search.json += event.delta.partial_json;
              const query = extractPartialStringField(search.json, 'query');
              if (query !== null && query !== search.step.query) {
                search.step.query = query;
                progress();
              }
            }
            const report = reporting.get(event.index);
            if (report !== undefined) {
              const json = report + event.delta.partial_json;
              reporting.set(event.index, json);
              opts.onReportJson?.(json);
            }
          } else if (event.type === 'content_block_stop') {
            const search = searching.get(event.index);
            searching.delete(event.index);
            const query = search ? searchQuery(search.json) : null;
            if (search && query !== null && query !== search.step.query) {
              search.step.query = query;
              progress();
            }
          }
        }

        const message = await stream.finalMessage();
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
          (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === tool.name,
        );
        if (report) {
          const usage: Usage = {
            model: message.model,
            inputTokens: total.input,
            outputTokens: total.output,
            webSearches: total.webSearches,
            costUsd: anthropicCostUsd(message.model, total),
          };
          const queries = steps.map((s) => s.query).filter((q) => q !== '');
          return { input: report.input, urls, queries, usage };
        }
        // サーバー側の検索が上限に達して一時停止した。そのまま送り返すと続きから再開する
        if (message.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: message.content });
      }
      throw new InvalidModelOutputError(
        tool.name === CLAIM_CHECK_TOOL_NAME ? M.errors.noFactCheck : M.errors.noReply,
      );
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
    effort: AnthropicEffort = this.config.effort,
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
          ...(supportsEffort(model) ? { effort } : {}),
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

/** 利用量を合計する（事実確認の複数の問い合わせ） */
function sumUsage(usages: Usage[]): Usage {
  const costs = usages.map((u) => u.costUsd);
  return {
    model: usages[0]?.model ?? '',
    inputTokens: usages.reduce((n, u) => n + u.inputTokens, 0),
    outputTokens: usages.reduce((n, u) => n + u.outputTokens, 0),
    webSearches: usages.reduce((n, u) => n + (u.webSearches ?? 0), 0),
    costUsd: costs.includes(undefined) ? undefined : costs.reduce<number>((n, c) => n + (c ?? 0), 0),
  };
}

/** items を、同時に limit 件までずつ fn で処理する。結果は items の順。1件でも例外なら全体も例外 */
async function mapConcurrently<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function stringOr(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
