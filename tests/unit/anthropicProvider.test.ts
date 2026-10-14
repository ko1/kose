import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { ANTHROPIC_ORIGIN, AnthropicProvider, supportsEffort } from '../../src/ai/anthropicProvider';
import { createProvider } from '../../src/ai/factory';
import type { FactCheckProgress, PartialExplanation, SearchProgress } from '../../src/domain/types';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';
import { fakeChrome } from '../fakeChrome';

const request = { requestId: 'r', sourceText: 'I has a pen.', targetLanguage: 'en' as const, situation: 'casual' as const, explanationLanguage: 'ja' };
const output = JSON.stringify({ revisedText: 'I have a pen.', detectedSourceLanguage: 'en' });
const explainOutput = JSON.stringify({
  explanation: '主語と動詞の一致を直しました。',
  changes: [{ before: 'has', after: 'have', type: 'objective_error', explanation: '主語が I なので have' }],
  nuanceWarnings: [],
});

type Event = Record<string, unknown>;

/** client.beta.messages.stream の戻り値を模したフェイク */
function fakeClient(
  events: Event[],
  final: { stop_reason: string; content: unknown[]; model?: string; usage?: Record<string, number | null> },
) {
  const stream = vi.fn((_params: Record<string, unknown>, _opts?: unknown) => ({
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
    finalMessage: async () => ({
      model: 'claude-opus-5',
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      ...final,
    }),
  }));
  const client = { beta: { messages: { stream } } } as unknown as Anthropic;
  return { client, stream };
}

const textDeltas = (text: string, size = 7): Event[] => {
  const out: Event[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + size) } });
  }
  return out;
};

const config = {
  apiKey: 'sk-ant-test',
  model: 'claude-opus-5',
  explainModel: 'claude-sonnet-5',
  effort: 'low' as const,
};

describe('AnthropicProvider', () => {
  it('APIキー未設定・ホスト権限なしでは利用不可', async () => {
    expect(await new AnthropicProvider({ ...config, apiKey: '' }).availability('en')).toMatchObject({ kind: 'unavailable' });
    expect(await new AnthropicProvider(config).availability('en')).toMatchObject({ kind: 'unavailable' });
    fakeChrome().permissions.granted.add(ANTHROPIC_ORIGIN);
    expect(await new AnthropicProvider(config).availability('en')).toEqual({ kind: 'available' });
  });

  it('構造化出力・effort 付きでストリーミングし、途中の改稿文を通知する', async () => {
    const { client, stream } = fakeClient(textDeltas(output), {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: output }],
    });
    const partials: string[] = [];
    const result = await new AnthropicProvider(config, () => client).rewrite(request, undefined, (t) =>
      partials.push(t),
    );
    expect(result.revisedText).toBe('I have a pen.');
    expect(partials.at(-1)).toBe('I have a pen.');
    expect(partials.length).toBeGreaterThan(1);

    const params = stream.mock.calls[0][0];
    expect(params).toMatchObject({
      model: 'claude-opus-5',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    // 1段目は手本なしの1往復（費用を抑える）
    const messages = params.messages as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(['user']);
  });

  it('explain は解説用のモデルと手本で問い合わせ、生成途中の解説を通知し、変更点を照合する', async () => {
    const { client, stream } = fakeClient(textDeltas(explainOutput, 5), {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: explainOutput }],
    });
    const partials: PartialExplanation[] = [];
    const e = await new AnthropicProvider(config, () => client).explain(
      { ...request, revisedText: 'I have a pen.', reviewStructure: false },
      undefined,
      (p) => partials.push(p),
    );
    expect(e.changes).toHaveLength(1);
    const params = stream.mock.calls[0][0] as { model: string; messages: { role: string }[] };
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    // 解説文が少しずつ伸び、最後に変更点が揃う
    const texts = partials.map((p) => p.explanation ?? '');
    expect(texts.some((t) => t.length > 0 && t.length < '主語と動詞の一致を直しました。'.length)).toBe(true);
    expect(partials.at(-1)?.changes).toHaveLength(1);
    // 同じ内容は重ねて通知しない
    expect(new Set(partials.map((p) => JSON.stringify(p))).size).toBe(partials.length);
  });

  it('長文では構成の項目を含むスキーマで解説を求める', async () => {
    const withStructure = JSON.stringify({
      ...JSON.parse(explainOutput),
      structure: { outline: ['経歴'], issues: [{ problem: '結論が最後', suggestion: '先頭へ' }] },
    });
    const { client, stream } = fakeClient([], { stop_reason: 'end_turn', content: [{ type: 'text', text: withStructure }] });
    const e = await new AnthropicProvider(config, () => client).explain({
      ...request,
      revisedText: 'I have a pen.',
      reviewStructure: true,
    });
    expect(e.structure?.issues).toHaveLength(1);
    const params = stream.mock.calls[0][0] as { output_config: { format: { schema: { required: string[] } } } };
    expect(params.output_config.format.schema.required).toContain('structure');
  });

  it('相談は解説と同じモデルで、会話履歴付きで問い合わせ、返答を生成しながら通知する', async () => {
    const reply = JSON.stringify({ reply: '苦労のニュアンスを加えました。', revisedText: 'I finally made it home.' });
    const { client, stream } = fakeClient(textDeltas(reply, 6), {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: reply }],
    });
    const partials: string[] = [];
    const r = await new AnthropicProvider(config, () => client).chat(
      {
        requestId: 'c',
        sourceText: '家に帰った',
        targetLanguage: 'en',
        situation: 'casual',
        explanationLanguage: 'ja',
        currentRevisedText: 'I went home.',
        previousRevisedTexts: ['I went home.'],
        history: [],
        message: 'もっと苦労した感じに',
      },
      undefined,
      (t) => partials.push(t),
    );
    expect(r.revisedText).toBe('I finally made it home.');
    expect(partials.at(-1)).toBe('苦労のニュアンスを加えました。');
    const params = stream.mock.calls[0][0] as { model: string; system: string; messages: { role: string }[] };
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.system).toContain('家に帰った');
    expect(params.messages).toEqual([{ role: 'user', content: 'もっと苦労した感じに' }]);
  });

  it('応答の利用量から料金を計算して返す', async () => {
    const { client } = fakeClient([], {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: output }],
      model: 'claude-haiku-4-5',
      usage: { input_tokens: 300, output_tokens: 150, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    });
    const result = await new AnthropicProvider({ ...config, model: 'claude-haiku-4-5' }, () => client).rewrite(request);
    expect(result.usage).toEqual({
      model: 'claude-haiku-4-5',
      inputTokens: 300,
      outputTokens: 150,
      costUsd: (300 * 1 + 150 * 5) / 1_000_000,
    });
  });

  it('Haiku には effort と fallbacks を送らない', async () => {
    const { client, stream } = fakeClient([], { stop_reason: 'end_turn', content: [{ type: 'text', text: output }] });
    await new AnthropicProvider({ ...config, model: 'claude-haiku-4-5' }, () => client).rewrite(request);
    const params = stream.mock.calls[0][0] as { output_config: Record<string, unknown> };
    expect(params.output_config.effort).toBeUndefined();
    expect(params).not.toHaveProperty('fallbacks');
    expect(supportsEffort('claude-sonnet-5')).toBe(true);
  });

  it('別モデルへの引き継ぎがあった場合は、引き継ぎ後の出力だけを使う', async () => {
    const events = [
      ...textDeltas('{"revisedText":"broken'),
      { type: 'content_block_start', index: 1, content_block: { type: 'fallback' } },
      ...textDeltas(output),
    ];
    const { client } = fakeClient(events, {
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: '{"revisedText":"broken' },
        { type: 'fallback' },
        { type: 'text', text: output },
      ],
    });
    const partials: string[] = [];
    const result = await new AnthropicProvider(config, () => client).rewrite(request, undefined, (t) =>
      partials.push(t),
    );
    expect(result.revisedText).toBe('I have a pen.');
    expect(partials.at(-1)).toBe('I have a pen.');
  });

  it('refusal と max_tokens はエラーにする', async () => {
    for (const stop_reason of ['refusal', 'max_tokens']) {
      const { client } = fakeClient([], { stop_reason, content: [] });
      await expect(new AnthropicProvider(config, () => client).rewrite(request)).rejects.toThrow(
        stop_reason === 'refusal' ? /declined/ : /cut off/,
      );
    }
  });

  describe('事実確認', () => {
    const factRequest = { requestId: 'f', sourceText: '東京タワーは1950年完成、高さ333m', explanationLanguage: 'ja', today: '2026-10-14' };
    const claimsJson = JSON.stringify({
      claims: [
        { quote: '1950年完成', claim: '東京タワーは1950年に完成した' },
        { quote: '高さ333m', claim: '東京タワーの高さは333m' },
      ],
    });
    const usage = (searches = 0) => ({ input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: { web_search_requests: searches, web_fetch_requests: 0 } });
    const searchEvents = (index: number, id: string, query: string): Event[] => [
      { type: 'content_block_start', index, content_block: { type: 'server_tool_use', id, name: 'web_search', input: {} } },
      { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
      { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(query) + '}' } },
      { type: 'content_block_stop', index },
    ];
    const searchResult = (id: string, url: string) => ({ type: 'web_search_tool_result', tool_use_id: id, content: [{ type: 'web_search_result', url, title: url }] });
    const verdict = (input: Record<string, unknown>) => ({ type: 'tool_use', id: 'v', name: 'report_verdict', input });
    type Response = { events: Event[]; final: { stop_reason: string; content: unknown[]; usage: ReturnType<typeof usage> } };

    /** system プロンプトで段を見分けて応答するフェイク。主張の確認は、本文の主張ごとに順に応答を返す */
    function stagedClient(perClaim: Record<string, Response[]>, summary = '一部に誤りがあります。') {
      const text = (t: string): Response => ({ events: textDeltas(t), final: { stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage: usage() } });
      const stream = vi.fn((params: Record<string, unknown>, _opts?: unknown) => {
        const system = params.system as string;
        const messages = params.messages as { content: string | { text: string }[] }[];
        let r: Response;
        if (system.includes('only list the claims')) r = text(claimsJson);
        else if (system.includes('overall assessment')) r = text(JSON.stringify({ summary }));
        else {
          const content = messages[0].content as { text: string }[];
          const key = Object.keys(perClaim).find((k) => content[1].text.includes(k))!;
          r = perClaim[key].shift()!;
        }
        return {
          async *[Symbol.asyncIterator]() {
            for (const e of r.events) yield e;
          },
          finalMessage: async () => ({ model: 'claude-sonnet-5', ...r.final }),
        };
      });
      return { client: { beta: { messages: { stream } } } as unknown as Anthropic, stream };
    }

    it('主張を抜き出し、主張ごとに Web 検索つきで並べて確かめ、全体の評価をまとめる', async () => {
      const { client, stream } = stagedClient({
        // 1件目: 検索が長引いて pause_turn → 続きで判定
        1950: [
          {
            events: [...searchEvents(0, 's0', '東京タワー 完成年'), { type: 'content_block_start', index: 1, content_block: searchResult('s0', 'https://example.com/tower') }],
            final: { stop_reason: 'pause_turn', content: [searchResult('s0', 'https://example.com/tower')], usage: usage(1) },
          },
          {
            events: [{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'v', name: 'report_verdict', input: {} } }],
            final: {
              stop_reason: 'tool_use',
              content: [verdict({ verdict: 'inaccurate', explanation: '1958年完成', sources: [{ title: 'Tower', url: 'https://example.com/tower/' }, { title: 'fake', url: 'https://fake.test/' }] })],
              usage: usage(),
            },
          },
        ],
        // 2件目: 検索結果にない URL しか挙げない → 確認できず
        333: [
          {
            events: searchEvents(0, 's1', '東京タワー 高さ'),
            final: {
              stop_reason: 'tool_use',
              content: [searchResult('s1', 'https://example.com/height'), verdict({ verdict: 'accurate', explanation: '333m', sources: [{ title: 'fake', url: 'https://fake.test/' }] })],
              usage: usage(1),
            },
          },
        ],
      });
      const progress: FactCheckProgress[] = [];
      const result = await new AnthropicProvider(config, () => client).factCheck(factRequest, undefined, (p) => progress.push(p));

      // 抜き出し → 主張ごとの確認 → まとめ の順に進み、主張は 待機中 → 確認中（検索の経過）→ 判定 と変わる
      expect(progress[0]).toEqual({ stage: 'extracting', claims: [] });
      expect(progress.some((p) => p.stage === 'extracting' && p.claims.length === 1)).toBe(true);
      expect(progress.map((p) => p.stage).filter((s, i, a) => s !== a[i - 1])).toEqual(['extracting', 'checking', 'summarizing']);
      const checking = progress.find((p) => p.claims[0]?.status === 'checking' && p.claims[0].search.phase === 'reading');
      expect(checking?.claims[0]).toMatchObject({ search: { searches: [{ query: '東京タワー 完成年', results: [{ url: 'https://example.com/tower' }] }] } });
      expect(progress.at(-1)?.claims.map((c) => c.status)).toEqual(['done', 'done']);
      expect(progress.at(-1)?.summary).toBe('一部に誤りがあります。');

      // 抜き出し1回 + 主張1件目2回（pause_turn）+ 2件目1回 + まとめ1回
      expect(stream).toHaveBeenCalledTimes(5);
      const claimCalls = stream.mock.calls
        .map((c) => c[0] as { system: string; tools?: { type?: string; name: string; strict?: boolean }[]; output_config?: { effort?: string }; messages: { role: string; content: unknown }[] })
        .filter((p) => p.tools);
      expect(claimCalls).toHaveLength(3);
      expect(claimCalls[0].tools?.[0]).toMatchObject({ type: 'web_search_20260209', name: 'web_search', max_uses: 10 });
      expect(claimCalls[0].tools?.[1]).toMatchObject({ name: 'report_verdict', strict: true });
      expect(claimCalls[0].output_config?.effort).toBe('high');
      // 原文の部分は主張をまたいでキャッシュする
      expect(claimCalls[0].messages[0].content).toEqual([
        expect.objectContaining({ text: expect.stringContaining('東京タワーは1950年完成'), cache_control: { type: 'ephemeral' } }),
        expect.objectContaining({ text: expect.stringContaining('東京タワーは1950年に完成した') }),
      ]);

      expect(result.summary).toBe('一部に誤りがあります。');
      expect(result.claims[0]).toMatchObject({ quote: '1950年完成', verdict: 'inaccurate', sources: [{ title: 'Tower', url: 'https://example.com/tower/' }] });
      expect(result.claims[1]).toMatchObject({ quote: '高さ333m', verdict: 'unverified', sources: [] });
      expect(result.queries).toEqual(['東京タワー 完成年', '東京タワー 高さ']);
      // 5回分のトークン代（Sonnet 5: $2/$10）と検索2回分（$0.02）
      expect(result.usage).toMatchObject({ inputTokens: 5000, outputTokens: 500, webSearches: 2 });
      expect(result.usage?.costUsd).toBeCloseTo(5 * (0.002 + 0.001) + 0.02);
    });

    it('一部の主張の確認に失敗しても、その主張だけ「確認できず」にして続ける', async () => {
      const { client } = stagedClient({
        1950: [{ events: [], final: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }], usage: usage() } }],
        333: [
          {
            events: [],
            final: {
              stop_reason: 'tool_use',
              content: [searchResult('s1', 'https://example.com/height'), verdict({ verdict: 'accurate', explanation: '333m', sources: [{ title: 'h', url: 'https://example.com/height' }] })],
              usage: usage(1),
            },
          },
        ],
      });
      const progress: FactCheckProgress[] = [];
      const result = await new AnthropicProvider(config, () => client).factCheck(factRequest, undefined, (p) => progress.push(p));
      expect(result.claims.map((c) => c.verdict)).toEqual(['unverified', 'accurate']);
      expect(result.claims[0].explanation).toMatch(/fact-check result/);
      expect(progress.at(-1)?.claims[0]).toMatchObject({ status: 'failed' });
    });

    it('全部の主張の確認に失敗したらエラー。Haiku では基本の Web 検索を使い effort を送らない', async () => {
      const fail = (): Response[] => [{ events: [], final: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }], usage: usage() } }];
      const { client, stream } = stagedClient({ 1950: fail(), 333: fail() });
      await expect(
        new AnthropicProvider({ ...config, explainModel: 'claude-haiku-4-5' }, () => client).factCheck(factRequest),
      ).rejects.toThrow(/fact-check result/);
      const params = stream.mock.calls.map((c) => c[0] as { tools?: { type?: string }[]; output_config?: { effort?: string } }).find((p) => p.tools)!;
      expect(params.tools?.[0].type).toBe('web_search_20250305');
      expect(params.output_config).toBeUndefined();
    });

    it('確かめる主張がなければ検索もまとめもしない', async () => {
      const { client, stream } = fakeClient(textDeltas('{"claims":[]}'), { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"claims":[]}' }] });
      const result = await new AnthropicProvider(config, () => client).factCheck(factRequest);
      expect(stream).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ summary: '', claims: [], queries: [] });
    });
  });

  it('事実確認の後の相談は Web 検索つきで、返答を生成しながら通知し、出典を検証する', async () => {
    const input = {
      reply: '1958年完成です。',
      revisedText: '',
      sources: [
        { title: 'search', url: 'https://example.com/s' },
        { title: 'fact check', url: 'https://example.com/t' },
        { title: 'made up', url: 'https://made.up/' },
      ],
    };
    const json = JSON.stringify(input);
    const events: Event[] = [
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 's0', name: 'web_search', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"東京タワー"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't', name: 'report_reply', input: {} } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: json.slice(0, 20) } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: json.slice(20) } },
      { type: 'content_block_stop', index: 2 },
    ];
    const { client, stream } = fakeClient(events, {
      stop_reason: 'tool_use',
      content: [
        { type: 'web_search_tool_result', tool_use_id: 's0', content: [{ type: 'web_search_result', url: 'https://example.com/s', title: 's' }] },
        { type: 'tool_use', id: 't', name: 'report_reply', input },
      ],
    });
    const partials: string[] = [];
    const searches: SearchProgress[] = [];
    const r = await new AnthropicProvider(config, () => client).chat(
      {
        requestId: 'c',
        sourceText: '東京タワーは1950年完成',
        targetLanguage: 'ja',
        situation: 'casual',
        explanationLanguage: 'ja',
        previousRevisedTexts: [],
        history: [],
        message: 'なぜ誤り？',
        webSearch: true,
        factCheck: {
          summary: 's',
          claims: [{ quote: '1950年', claim: 'c', verdict: 'inaccurate', explanation: 'e', sources: [{ title: 't', url: 'https://example.com/t' }] }],
          queries: [],
          createdAt: 0,
        },
      },
      undefined,
      (p) => partials.push(p),
      (q) => searches.push(q),
    );
    const params = stream.mock.calls[0][0] as { tools: { name: string; strict?: boolean }[]; output_config?: { format?: unknown } };
    expect(params.tools.map((t) => t.name)).toEqual(['web_search', 'report_reply']);
    expect(params.output_config?.format).toBeUndefined();
    expect(searches.at(-1)?.searches.map((s) => s.query)).toEqual(['東京タワー']);
    expect(searches.at(-1)?.phase).toBe('writing');
    expect(partials.at(-1)).toBe('1958年完成です。');
    expect(r.revisedText).toBeUndefined();
    expect(r.sources?.map((s) => s.title)).toEqual(['search', 'fact check']);
  });

  it('入力の文字数に上限を設けない', () => {
    expect('checkInput' in new AnthropicProvider(config)).toBe(false);
  });

  it('設定で Claude を選ぶと AnthropicProvider を作る', () => {
    expect(createProvider({ ...DEFAULT_SETTINGS, provider: 'anthropic' }).id).toBe('anthropic');
    expect(DEFAULT_SETTINGS.anthropicModel).toBe('claude-haiku-4-5');
    expect(DEFAULT_SETTINGS.anthropicExplainModel).toBe('claude-sonnet-5');
    expect(DEFAULT_SETTINGS.anthropicEffort).toBe('low');
  });
});
