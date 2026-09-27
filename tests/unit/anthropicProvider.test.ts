import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { ANTHROPIC_ORIGIN, AnthropicProvider, supportsEffort } from '../../src/ai/anthropicProvider';
import { createProvider } from '../../src/ai/factory';
import type { PartialExplanation } from '../../src/domain/types';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';
import { fakeChrome } from '../fakeChrome';

const request = { requestId: 'r', sourceText: 'I has a pen.', targetLanguage: 'en' as const, situation: 'casual' as const };
const output = JSON.stringify({ revisedText: 'I have a pen.', detectedSourceLanguage: 'en' });
const explainOutput = JSON.stringify({
  explanationJa: '主語と動詞の一致を直しました。',
  changes: [{ before: 'has', after: 'have', type: 'objective_error', explanationJa: '主語が I なので have' }],
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
  maxInputChars: 100,
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
      { ...request, revisedText: 'I have a pen.' },
      undefined,
      (p) => partials.push(p),
    );
    expect(e.changes).toHaveLength(1);
    const params = stream.mock.calls[0][0] as { model: string; messages: { role: string }[] };
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    // 解説文が少しずつ伸び、最後に変更点が揃う
    const texts = partials.map((p) => p.explanationJa ?? '');
    expect(texts.some((t) => t.length > 0 && t.length < '主語と動詞の一致を直しました。'.length)).toBe(true);
    expect(partials.at(-1)?.changes).toHaveLength(1);
    // 同じ内容は重ねて通知しない
    expect(new Set(partials.map((p) => JSON.stringify(p))).size).toBe(partials.length);
  });

  it('相談は解説と同じモデルで、会話履歴付きで問い合わせ、返答を生成しながら通知する', async () => {
    const reply = JSON.stringify({ replyJa: '苦労のニュアンスを加えました。', revisedText: 'I finally made it home.' });
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
        stop_reason === 'refusal' ? /断りました/ : /打ち切られました/,
      );
    }
  });

  it('入力の文字数上限', async () => {
    const p = new AnthropicProvider({ ...config, maxInputChars: 5 });
    expect(await p.checkInput({ ...request, sourceText: '12345' })).toEqual({ ok: true });
    expect(await p.checkInput({ ...request, sourceText: '123456' })).toEqual({ ok: false, limit: 5, unit: 'chars' });
  });

  it('設定で Claude を選ぶと AnthropicProvider を作る', () => {
    expect(createProvider({ ...DEFAULT_SETTINGS, provider: 'anthropic' }).id).toBe('anthropic');
    expect(DEFAULT_SETTINGS.anthropicModel).toBe('claude-haiku-4-5');
    expect(DEFAULT_SETTINGS.anthropicExplainModel).toBe('claude-sonnet-5');
    expect(DEFAULT_SETTINGS.anthropicEffort).toBe('low');
  });
});
