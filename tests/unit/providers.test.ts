import { describe, expect, it, vi } from 'vitest';
import { BuiltinProvider, languageOptions } from '../../src/ai/builtinProvider';
import { createProvider } from '../../src/ai/factory';
import { OPENAI_ORIGIN, OpenAIProvider } from '../../src/ai/openaiProvider';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';
import { fakeChrome } from '../fakeChrome';

const output = JSON.stringify({ revisedText: 'Hello.', detectedSourceLanguage: 'ja' });
const explainOutput = JSON.stringify({
  explanationJa: '挨拶を英訳しました。',
  changes: [{ before: 'こんにちは', after: 'Hello', type: 'style', explanationJa: '一般的な挨拶' }],
  nuanceWarnings: [],
});
const request = { requestId: 'r', sourceText: 'こんにちは。', targetLanguage: 'en' as const, situation: 'casual' as const };
const explainRequest = { ...request, revisedText: 'Hello.' };
const chatRequest = {
  requestId: 'c',
  sourceText: 'こんにちは。',
  targetLanguage: 'en' as const,
  situation: 'casual' as const,
  currentRevisedText: 'Hello.',
  previousRevisedTexts: ['Hello.'],
  history: [
    { role: 'user' as const, content: '1' },
    { role: 'assistant' as const, content: '2' },
    { role: 'user' as const, content: '3' },
    { role: 'assistant' as const, content: '4' },
  ],
  message: 'もっとくだけて',
};
const chatOutput = JSON.stringify({ replyJa: 'くだけました', revisedText: 'Hi!' });

function installLanguageModel(state: LanguageModelAvailability, prompt = vi.fn(async () => output)) {
  const lm = {
    availability: vi.fn(async () => state),
    create: vi.fn(async () => ({ prompt, destroy: vi.fn() })),
  };
  (globalThis as { LanguageModel?: unknown }).LanguageModel = lm;
  return { lm, prompt };
}

describe('BuiltinProvider', () => {
  it('解説が日本語なので出力言語に常に ja を含める', () => {
    expect(languageOptions('en').expectedOutputs?.[0].languages).toEqual(['en', 'ja']);
    expect(languageOptions('ja').expectedOutputs?.[0].languages).toEqual(['ja']);
  });

  it('Prompt API が無い環境では利用不可と理由を返す', async () => {
    const a = await new BuiltinProvider().availability('en');
    expect(a.kind).toBe('unavailable');
  });

  it.each([
    ['available', 'available'],
    ['downloadable', 'needs-download'],
    ['downloading', 'downloading'],
    ['unavailable', 'unavailable'],
  ] as const)('availability %s → %s', async (state, kind) => {
    installLanguageModel(state);
    expect((await new BuiltinProvider().availability('en')).kind).toBe(kind);
  });

  it('rewrite は JSON Schema 制約付きで問い合わせ、結果を検証する', async () => {
    const { lm, prompt } = installLanguageModel('available');
    const result = await new BuiltinProvider().rewrite(request);
    expect(result.revisedText).toBe('Hello.');
    // 1段目は短いシステムプロンプトだけ
    expect(lm.create).toHaveBeenCalledWith(
      expect.objectContaining({ initialPrompts: [expect.objectContaining({ role: 'system' })] }),
    );
    expect(prompt).toHaveBeenCalledWith(
      expect.stringContaining('こんにちは。'),
      expect.objectContaining({ responseConstraint: expect.objectContaining({ type: 'object' }) }),
    );
  });

  it('システムプロンプト読み込み済みのセッションを保持し、実行ごとに複製して使う', async () => {
    const clonePrompt = vi.fn(async () => output);
    const clones: { destroy: ReturnType<typeof vi.fn> }[] = [];
    const base = {
      prompt: vi.fn(),
      destroy: vi.fn(),
      clone: vi.fn(async () => {
        const c = { prompt: clonePrompt, destroy: vi.fn() };
        clones.push(c);
        return c;
      }),
    };
    const lm = { availability: vi.fn(async () => 'available'), create: vi.fn(async () => base) };
    (globalThis as { LanguageModel?: unknown }).LanguageModel = lm;

    const p = new BuiltinProvider();
    await p.rewrite(request);
    await new BuiltinProvider().rewrite(request);
    expect(lm.create).toHaveBeenCalledTimes(1);
    expect(base.clone).toHaveBeenCalledTimes(2);
    expect(base.prompt).not.toHaveBeenCalled();
    expect(clones.every((c) => c.destroy.mock.calls.length === 1)).toBe(true);
    expect(base.destroy).not.toHaveBeenCalled();
  });

  it('ストリーミングで生成途中の改稿文を通知し、最後に全体を検証する', async () => {
    const chunks = ['{"revisedText":"Hel', 'lo.","detectedSource', 'Language":"ja"}'];
    const session = {
      prompt: vi.fn(),
      destroy: vi.fn(),
      promptStreaming: vi.fn(
        () =>
          new ReadableStream<string>({
            start(controller) {
              for (const c of chunks) controller.enqueue(c);
              controller.close();
            },
          }),
      ),
    };
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: vi.fn(async () => 'available'),
      create: vi.fn(async () => session),
    };
    const partials: string[] = [];
    const result = await new BuiltinProvider().rewrite(request, undefined, (t) => partials.push(t));
    expect(partials).toEqual(['Hel', 'Hello.']);
    expect(result.revisedText).toBe('Hello.');
    expect(session.prompt).not.toHaveBeenCalled();
  });

  it('explain は手本付きの別セッションで問い合わせ、変更点を照合する', async () => {
    const { lm } = installLanguageModel('available', vi.fn(async () => explainOutput));
    const e = await new BuiltinProvider().explain(explainRequest);
    expect(e.changes).toHaveLength(1);
    expect(e.droppedChanges).toBe(0);
    expect(lm.create).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPrompts: [expect.objectContaining({ role: 'system' }), expect.anything(), expect.anything()],
      }),
    );
  });

  it('相談はコンテキストに入らなければ古い発言から1往復ずつ削る', async () => {
    const created: { initialPrompts: { role: string }[] }[] = [];
    const lm = {
      availability: vi.fn(async () => 'available'),
      create: vi.fn(async (opts: { initialPrompts: { role: string }[] }) => {
        created.push(opts);
        return {
          prompt: vi.fn(async () => chatOutput),
          destroy: vi.fn(),
          inputQuota: 100,
          inputUsage: opts.initialPrompts.length * 20,
          measureInputUsage: vi.fn(async () => 10),
        };
      }),
    };
    (globalThis as { LanguageModel?: unknown }).LanguageModel = lm;
    const r = await new BuiltinProvider().chat(chatRequest);
    expect(r).toEqual({ replyJa: 'くだけました', revisedText: 'Hi!' });
    // system + 4発言(=100) → system + 2発言(=60) で収まる
    expect(created.map((c) => c.initialPrompts.length)).toEqual([5, 3]);
  });

  it('prewarm はモデルが利用可能なときだけ準備し、ダウンロードは始めない', async () => {
    const { lm } = installLanguageModel('downloadable');
    await new BuiltinProvider().prewarm('en');
    expect(lm.create).not.toHaveBeenCalled();

    lm.availability.mockResolvedValue('available');
    await new BuiltinProvider().prewarm('en');
    expect(lm.create).toHaveBeenCalledTimes(1);
    // 2回目の prewarm は保持しているセッションを使い回す
    await new BuiltinProvider().prewarm('en');
    expect(lm.create).toHaveBeenCalledTimes(1);
  });

  it('入力上限の計測APIが無ければ文字数で判定する', async () => {
    installLanguageModel('available');
    const p = new BuiltinProvider();
    expect(await p.checkInput(request)).toEqual({ ok: true });
    expect(await p.checkInput({ ...request, sourceText: 'あ'.repeat(2001) })).toMatchObject({ ok: false });
  });
});

describe('OpenAIProvider', () => {
  const config = { apiKey: 'sk-test', model: 'test-model', maxInputChars: 10 };

  it('APIキー未設定なら利用不可', async () => {
    const p = new OpenAIProvider({ ...config, apiKey: '' });
    expect(await p.availability('en')).toMatchObject({ kind: 'unavailable' });
  });

  it('ホスト権限が無ければ利用不可', async () => {
    expect(await new OpenAIProvider(config).availability('en')).toMatchObject({ kind: 'unavailable' });
    fakeChrome().permissions.granted.add(OPENAI_ORIGIN);
    expect(await new OpenAIProvider(config).availability('en')).toEqual({ kind: 'available' });
  });

  it('Structured Outputs で問い合わせ、結果を検証する', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: output } }] }), { status: 200 }),
    );
    const result = await new OpenAIProvider(config, fetchImpl).rewrite(request);
    expect(result.revisedText).toBe('Hello.');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('test-model');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it('explain は解説用のスキーマと手本で問い合わせる', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: explainOutput } }] }), { status: 200 }),
    );
    const e = await new OpenAIProvider(config, fetchImpl).explain(explainRequest);
    expect(e.explanationJa).toBe('挨拶を英訳しました。');
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.response_format.json_schema.name).toBe('explanation');
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('相談はシステムプロンプトと会話履歴で問い合わせる', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: chatOutput } }] }), { status: 200 }),
    );
    const r = await new OpenAIProvider(config, fetchImpl).chat(chatRequest);
    expect(r.revisedText).toBe('Hi!');
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user']);
  });

  it('401 はAPIキーの問題として報告する', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
    await expect(new OpenAIProvider(config, fetchImpl).rewrite(request)).rejects.toThrow(/APIキーが無効/);
  });

  it('入力の文字数上限', async () => {
    const p = new OpenAIProvider(config);
    expect(await p.checkInput({ ...request, sourceText: '0123456789' })).toEqual({ ok: true });
    expect(await p.checkInput({ ...request, sourceText: '01234567890' })).toEqual({ ok: false, limit: 10, unit: 'chars' });
  });
});

describe('createProvider', () => {
  it('設定で選ばれたプロバイダーだけを作る', () => {
    expect(createProvider(DEFAULT_SETTINGS).id).toBe('builtin');
    expect(createProvider({ ...DEFAULT_SETTINGS, provider: 'openai' }).id).toBe('openai');
  });
});
