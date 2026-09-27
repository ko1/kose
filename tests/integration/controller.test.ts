import { describe, expect, it, vi } from 'vitest';
import type { AIProvider, InputCheck, ProviderAvailability } from '../../src/ai/provider';
import { KoseController } from '../../src/app/controller';
import type {
  ChatReply,
  ChatRequest,
  Explanation,
  ExplainRequest,
  PartialExplanation,
  PendingRequest,
  RewriteRequest,
  RewriteResult,
} from '../../src/domain/types';
import { loadMistakes, saveMistakes } from '../../src/storage/mistakeStore';
import { putPending, requestScratch } from '../../src/storage/sessionStore';
import { SCRATCH_TAB_ID } from '../../src/domain/session';
import { saveSettings, Settings } from '../../src/storage/settings';
import { fakeChrome } from '../fakeChrome';

/** 呼び出しごとに手動で解決できるフェイクプロバイダー */
class FakeProvider implements AIProvider {
  readonly id = 'builtin' as const;
  readonly label = 'fake';
  sendsExternally = false;
  availabilityResult: ProviderAvailability = { kind: 'available' };
  inputCheck: InputCheck = { ok: true };
  calls: { request: RewriteRequest; signal?: AbortSignal; onPartial?: (t: string) => void; resolve: (v: RewriteResult) => void; reject: (e: unknown) => void }[] = [];
  explainCalls: { request: ExplainRequest; signal?: AbortSignal; onPartial?: (p: PartialExplanation) => void; resolve: (v: Explanation) => void; reject: (e: unknown) => void }[] = [];
  prepared = 0;
  /** prepare の完了を外から制御したい場合に差し替える */
  prepareImpl: (onProgress: (ratio: number) => void) => Promise<void> = async () => {};

  async availability() {
    return this.availabilityResult;
  }
  async checkInput() {
    return this.inputCheck;
  }
  prewarmed: string[] = [];
  async prewarm(target: string) {
    this.prewarmed.push(target);
  }
  rewrite(request: RewriteRequest, signal?: AbortSignal, onPartial?: (t: string) => void) {
    return new Promise<RewriteResult>((resolve, reject) => {
      this.calls.push({ request, signal, onPartial, resolve, reject });
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  }
  chatCalls: { request: ChatRequest; signal?: AbortSignal; onPartial?: (t: string) => void; resolve: (v: ChatReply) => void; reject: (e: unknown) => void }[] = [];
  chat(request: ChatRequest, signal?: AbortSignal, onPartial?: (t: string) => void) {
    return new Promise<ChatReply>((resolve, reject) => {
      this.chatCalls.push({ request, signal, onPartial, resolve, reject });
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  }
  explain(request: ExplainRequest, signal?: AbortSignal, onPartial?: (p: PartialExplanation) => void) {
    return new Promise<Explanation>((resolve, reject) => {
      this.explainCalls.push({ request, signal, onPartial, resolve, reject });
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  }
  answerExplain(index: number, explanation: string) {
    this.explainCalls[index].resolve({ explanation, changes: [], nuanceWarnings: [], droppedChanges: 0 });
  }
  async prepare(_target: string, onProgress: (ratio: number) => void) {
    this.prepared++;
    await this.prepareImpl(onProgress);
  }
  answer(index: number, text: string) {
    this.calls[index].resolve({ revisedText: text, detectedSourceLanguage: 'ja' });
  }
}

let seq = 0;
const pending = (tabId: number, text = `text ${tabId}`, targetLanguage: 'ja' | 'en' = 'en'): PendingRequest => ({
  requestId: `req-${++seq}`,
  targetLanguage,
  text,
  source: { tabId, frameId: 0, tabTitle: `Tab ${tabId}`, textSource: 'script', editable: false },
  createdAt: seq,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup(opts: { provider?: FakeProvider; factory?: (s: Settings) => AIProvider } = {}) {
  const provider = opts.provider ?? new FakeProvider();
  const controller = new KoseController(opts.factory ?? (() => provider));
  await controller.init();
  const snap = () => controller.getSnapshot()!;
  return { provider, controller, snap };
}

describe('KoseController', () => {
  it('右クリック要求を受けて即時に実行し、結果を表示する', async () => {
    const { provider, snap } = await setup();
    await putPending(pending(1, 'こんにちは', 'en'));
    await flush();
    expect(snap().displayed?.status.kind).toBe('running');
    expect(provider.calls[0].request).toMatchObject({ sourceText: 'こんにちは', targetLanguage: 'en', situation: 'casual' });

    provider.answer(0, 'Hello');
    await flush();
    expect(snap().displayed?.status.kind).toBe('idle');
    expect(snap().displayed?.versions[0]).toMatchObject({ origin: 'initial', result: { revisedText: 'Hello' } });
    // pending request は消費され、セッションは storage.session に保存される
    const data = fakeChrome().storage.session.data;
    expect(Object.keys(data).filter((k) => k.startsWith('pending:'))).toEqual([]);
    expect(data['session:1']).toBeDefined();
  });

  it('生成途中の改稿文を表示中のセッションについて公開し、完了したら消す', async () => {
    const { provider, snap } = await setup();
    await putPending(pending(1));
    await flush();
    provider.calls[0].onPartial?.('Hel');
    expect(snap().partialText).toBe('Hel');
    provider.answer(0, 'Hello');
    await flush();
    expect(snap().displayed?.versions).toHaveLength(1);
    await putPending(pending(1));
    await flush();
    expect(snap().partialText).toBeNull();
  });

  it('ウィンドウを開いた時点と機能（仕上がりの言語）の変更時に準備（prewarm）する', async () => {
    const { provider, controller } = await setup();
    expect(provider.prewarmed).toEqual(['en']);
    await controller.updateSettings({ targetLanguage: 'ja' });
    expect(provider.prewarmed).toEqual(['en', 'ja']);
  });

  it('Chrome内蔵AIなど外部送信しないプロバイダーでは、改稿に続けて解説を自動で生成する', async () => {
    const { provider, snap } = await setup();
    await putPending(pending(1, '原文'));
    await flush();
    provider.answer(0, '改稿');
    await flush();
    expect(provider.explainCalls[0].request).toMatchObject({ sourceText: '原文', revisedText: '改稿' });
    const versionId = snap().displayed!.currentVersionId!;
    expect(snap().explainStates[versionId]?.kind).toBe('running');
    // 生成途中の解説を公開する
    provider.explainCalls[0].onPartial?.({ explanation: '解説で' });
    expect(snap().explainStates[versionId]).toMatchObject({ kind: 'running', partial: { explanation: '解説で' } });
    provider.answerExplain(0, '解説です');
    await flush();
    expect(snap().displayed?.versions[0].explanation).toMatchObject({ explanation: '解説です', provider: 'builtin' });
    expect(snap().explainStates[versionId]).toBeUndefined();
  });

  it('長文の改稿では解説で構成も見る', async () => {
    const { provider } = await setup();
    await putPending(pending(1, '短い'));
    await flush();
    provider.answer(0, '短い改稿');
    await flush();
    expect(provider.explainCalls[0].request.reviewStructure).toBe(false);
    await putPending(pending(2, '長い'));
    await flush();
    provider.answer(1, 'x'.repeat(600));
    await flush();
    expect(provider.explainCalls[1].request.reviewStructure).toBe(true);
  });

  it('クラウドでは解説を自動で生成せず、要求されたときだけ生成する', async () => {
    const provider = new FakeProvider();
    provider.sendsExternally = true;
    const { controller, snap } = await setup({ provider });
    await putPending(pending(1));
    await flush();
    provider.answer(0, '改稿');
    await flush();
    expect(provider.explainCalls).toHaveLength(0);

    const done = controller.explain(1);
    await flush();
    expect(provider.explainCalls).toHaveLength(1);
    // 生成中に重ねて押しても二重に問い合わせない
    await controller.explain(1);
    expect(provider.explainCalls).toHaveLength(1);
    provider.answerExplain(0, 'ok');
    await done;
    expect(snap().displayed?.versions[0].explanation?.explanation).toBe('ok');
    // 生成済みなら問い合わせない
    await controller.explain(1);
    expect(provider.explainCalls).toHaveLength(1);
  });

  it('設定でクラウドでも解説を自動で生成できる', async () => {
    await saveSettings({ autoExplainCloud: true });
    const provider = new FakeProvider();
    provider.sendsExternally = true;
    await setup({ provider });
    await putPending(pending(1));
    await flush();
    provider.answer(0, '改稿');
    await flush();
    expect(provider.explainCalls).toHaveLength(1);
  });

  it('解説のエラーは改稿結果を消さずに表示し、再生成できる', async () => {
    const { provider, controller, snap } = await setup();
    await putPending(pending(1));
    await flush();
    provider.answer(0, '改稿');
    await flush();
    provider.explainCalls[0].reject(new Error('壊れた応答'));
    await flush();
    const versionId = snap().displayed!.currentVersionId!;
    expect(snap().explainStates[versionId]).toEqual({ kind: 'error', message: '壊れた応答' });
    expect(snap().displayed?.versions[0].result.revisedText).toBe('改稿');
    const retry = controller.explain(1, versionId);
    await flush();
    provider.answerExplain(1, 'ok');
    await retry;
    expect(snap().displayed?.versions[0].explanation?.explanation).toBe('ok');
  });

  it('同じタブの新しい右クリックで、前のレビューの解説生成を止める', async () => {
    const { provider } = await setup();
    await putPending(pending(1));
    await flush();
    provider.answer(0, '改稿');
    await flush();
    await putPending(pending(1));
    await flush();
    expect(provider.explainCalls[0].signal?.aborted).toBe(true);
  });

  describe('ニュアンス相談', () => {
    async function reviewed(provider = new FakeProvider()) {
      const ctx = await setup({ provider });
      await putPending(pending(1, '家に帰った'));
      await flush();
      provider.answer(0, 'I went home.');
      await flush();
      provider.answerExplain(0, '解説');
      await flush();
      return ctx;
    }

    it('書き換えの依頼で新しい案が追加されて表示され、会話に残る', async () => {
      const { provider, controller, snap } = await reviewed();
      const firstVersion = snap().displayed!.currentVersionId!;
      const sent = controller.sendChat(1, 'もっと苦労して帰宅したニュアンスにして');
      await flush();
      const call = provider.chatCalls[0];
      expect(call.request).toMatchObject({
        sourceText: '家に帰った',
        currentRevisedText: 'I went home.',
        history: [],
        message: 'もっと苦労して帰宅したニュアンスにして',
      });
      // 返答を生成しながら表示する
      call.onPartial?.('苦労');
      expect(snap().chatState).toMatchObject({ kind: 'running', partial: '苦労' });

      call.resolve({ reply: '苦労のニュアンスを加えました。', revisedText: 'I finally made it home.' });
      await sent;
      const s = snap().displayed!;
      expect(s.versions.map((v) => v.origin)).toEqual(['initial', 'chat']);
      expect(s.versions[1].result.revisedText).toBe('I finally made it home.');
      expect(s.currentVersionId).toBe(s.versions[1].id);
      expect(s.messages).toEqual([
        { role: 'user', content: 'もっと苦労して帰宅したニュアンスにして' },
        { role: 'assistant', content: '苦労のニュアンスを加えました。', versionId: s.versions[1].id, usage: undefined },
      ]);
      expect(snap().chatState).toBeNull();
      // 過去の案に戻せる
      controller.selectVersion(1, firstVersion);
      expect(snap().displayed?.currentVersionId).toBe(firstVersion);
      // 内蔵AIなので新しい案の解説も自動で生成する
      expect(provider.explainCalls.at(-1)?.request.revisedText).toBe('I finally made it home.');
    });

    it('説明だけの返答では RESULT を変えない。2回目は会話履歴を渡す', async () => {
      const { provider, controller, snap } = await reviewed();
      const sent = controller.sendChat(1, 'went と got の違いは？');
      await flush();
      provider.chatCalls[0].resolve({ reply: 'got は到着の過程を含みます。' });
      await sent;
      expect(snap().displayed!.versions).toHaveLength(1);

      void controller.sendChat(1, 'じゃあ got にして');
      await flush();
      expect(provider.chatCalls[1].request.history).toEqual([
        { role: 'user', content: 'went と got の違いは？' },
        { role: 'assistant', content: 'got は到着の過程を含みます。', revisedText: undefined },
      ]);
    });

    it('相談の返答待ちに作り直すと相談を止め、作り直した案だけが追加される', async () => {
      const { provider, controller, snap } = await reviewed();
      void controller.sendChat(1, 'もっと丁寧に');
      await flush();
      await controller.updateSettings({ situation: 'business' });
      void controller.regenerate(1);
      await flush();
      expect(provider.chatCalls[0].signal?.aborted).toBe(true);
      expect(snap().chatState).toBeNull();

      provider.chatCalls[0].resolve({ reply: '遅れて届いた返答', revisedText: 'Late chat version.' });
      provider.calls.at(-1)!.resolve({ revisedText: 'Regenerated.', detectedSourceLanguage: 'ja' });
      await flush();
      await flush();
      const versions = snap().displayed!.versions;
      expect(versions.map((v) => v.origin)).toEqual(['initial', 'regenerate']);
      expect(versions[1].result.revisedText).toBe('Regenerated.');
      expect(snap().displayed!.messages.map((m) => m.role)).toEqual(['user']);
    });

    it('次のレビューや他タブのレビューに会話が混ざらない', async () => {
      const { provider, controller } = await reviewed();
      const sent = controller.sendChat(1, '質問1');
      await flush();
      provider.chatCalls[0].resolve({ reply: '回答1' });
      await sent;

      // 別のタブ
      await putPending(pending(2, '別の文'));
      await flush();
      provider.answer(1, 'Another sentence.');
      await flush();
      void controller.sendChat(2, '質問2');
      await flush();
      expect(provider.chatCalls[1].request).toMatchObject({ sourceText: '別の文', history: [] });

      // 同じタブで新しい右クリック
      await putPending(pending(1, '新しい文'));
      await flush();
      provider.answer(2, 'A new sentence.');
      await flush();
      void controller.sendChat(1, '質問3');
      await flush();
      expect(provider.chatCalls[2].request).toMatchObject({ sourceText: '新しい文', history: [] });
    });

    it('改稿の実行中や返答待ちの間は送れない。新しい右クリックで相談を止める', async () => {
      const { provider, controller } = await reviewed();
      void controller.sendChat(1, 'a');
      await flush();
      await controller.sendChat(1, 'b');
      expect(provider.chatCalls).toHaveLength(1);
      await putPending(pending(1));
      await flush();
      expect(provider.chatCalls[0].signal?.aborted).toBe(true);
      await controller.sendChat(1, 'c'); // 改稿の実行中
      expect(provider.chatCalls).toHaveLength(1);
    });

    it('失敗したら送り直せる（発言を二重に追加しない）', async () => {
      const { provider, controller, snap } = await reviewed();
      void controller.sendChat(1, '質問');
      await flush();
      provider.chatCalls[0].reject(new Error('混雑'));
      await flush();
      expect(snap().chatState).toEqual({ kind: 'error', message: '混雑' });
      void controller.retryChat(1);
      await flush();
      expect(provider.chatCalls[1].request).toMatchObject({ message: '質問', history: [] });
      provider.chatCalls[1].resolve({ reply: '回答' });
      await flush();
      expect(snap().displayed!.messages.map((m) => m.content)).toEqual(['質問', '回答']);
    });
  });

  it('右クリックで選んだターゲットを下部ドロップダウン（設定）に反映する', async () => {
    const { snap } = await setup();
    await putPending(pending(1, 'Hi', 'ja'));
    await flush();
    expect(snap().settings.targetLanguage).toBe('ja');
  });

  it('ウィンドウが開く前に書かれた要求も起動時に処理する', async () => {
    await putPending(pending(5));
    const { provider, snap } = await setup();
    await flush();
    expect(provider.calls).toHaveLength(1);
    expect(snap().displayed?.source.tabId).toBe(5);
  });

  it('同じタブの新しい右クリックで先行リクエストをキャンセルし、古い応答を破棄する', async () => {
    const { provider, snap } = await setup();
    await putPending(pending(1, 'first'));
    await flush();
    await putPending(pending(1, 'second'));
    await flush();
    expect(provider.calls[0].signal?.aborted).toBe(true);
    provider.answer(0, 'stale');
    provider.answer(1, 'fresh');
    await flush();
    expect(snap().displayed?.sourceText).toBe('second');
    expect(snap().displayed?.versions.map((v) => v.result.revisedText)).toEqual(['fresh']);
  });

  it('他タブの要求はキャンセルせず、それぞれのセッションに結果が入る', async () => {
    const { provider, snap } = await setup();
    await putPending(pending(1, 'one'));
    await flush();
    await putPending(pending(2, 'two'));
    await flush();
    expect(provider.calls[0].signal?.aborted).toBe(false);
    provider.answer(0, 'ONE');
    provider.answer(1, 'TWO');
    await flush();
    const byTab = new Map(snap().sessions.map((s) => [s.source.tabId, s.versions[0]?.result.revisedText]));
    expect(byTab).toEqual(new Map([[1, 'ONE'], [2, 'TWO']]));
  });

  it('tab1→tab2で呼び、tab1を選ぶとkose1、セッションのないtab3では表示を維持', async () => {
    const { provider, controller, snap } = await setup();
    await putPending(pending(1, 'kose1'));
    await flush();
    await putPending(pending(2, 'kose2'));
    await flush();
    expect(snap().displayed?.sourceText).toBe('kose2');

    fakeChrome().tabs.onActivated.dispatch({ tabId: 1, windowId: 1 });
    expect(snap().displayed?.sourceText).toBe('kose1');
    fakeChrome().tabs.onActivated.dispatch({ tabId: 3, windowId: 1 });
    expect(snap().displayed?.sourceText).toBe('kose1');
    // 表示の切替では実行中のリクエストを止めない
    expect(provider.calls.every((c) => !c.signal?.aborted)).toBe(true);
    // セッション一覧から手動で選べる
    controller.showSession(2);
    expect(snap().displayed?.sourceText).toBe('kose2');
  });

  it('koseウィンドウ自身のタブのアクティブ化は無視する', async () => {
    const c = fakeChrome();
    c.windows.currentId = 99;
    const { snap } = await setup();
    await putPending(pending(1));
    await flush();
    c.tabs.onActivated.dispatch({ tabId: 500, windowId: 99 });
    expect(snap().displayed?.source.tabId).toBe(1);
  });

  it('元タブを閉じるとセッションを破棄し、実行中の応答も捨てる', async () => {
    const { provider, snap } = await setup();
    await putPending(pending(1));
    await flush();
    fakeChrome().tabs.onRemoved.dispatch(1, {});
    expect(provider.calls[0].signal?.aborted).toBe(true);
    expect(snap().displayed).toBeNull();
    expect(snap().sessions).toEqual([]);
  });

  it('ドロップダウンの変更だけではAPIを呼ばず、再生成で新しいバージョンを追加する', async () => {
    const { provider, controller, snap } = await setup();
    await putPending(pending(1, '原文', 'en'));
    await flush();
    provider.answer(0, 'v1');
    await flush();

    await controller.updateSettings({ targetLanguage: 'ja', situation: 'business' });
    expect(provider.calls).toHaveLength(1);

    await flush();
    const regen = controller.regenerate(1);
    await flush();
    expect(provider.calls[1].request).toMatchObject({ sourceText: '原文', targetLanguage: 'ja', situation: 'business' });
    provider.answer(1, 'v2');
    await regen;
    const versions = snap().displayed!.versions;
    expect(versions.map((v) => [v.origin, v.targetLanguage, v.situation])).toEqual([
      ['initial', 'en', 'casual'],
      ['regenerate', 'ja', 'business'],
    ]);
    controller.selectVersion(1, versions[0].id);
    expect(snap().displayed?.currentVersionId).toBe(versions[0].id);
  });

  it('Chrome内蔵AIが使えないときはエラーを表示し、他のプロバイダーに自動で切り替えない', async () => {
    const builtin = new FakeProvider();
    builtin.availabilityResult = { kind: 'unavailable', reason: '非対応環境' };
    const factory = vi.fn((s: Settings) => {
      if (s.provider !== 'builtin') throw new Error('クラウドに切り替えてはいけない');
      return builtin;
    });
    const { snap } = await setup({ factory });
    await putPending(pending(1));
    await flush();
    expect(snap().displayed?.status).toEqual({ kind: 'error', message: '非対応環境' });
    expect(builtin.calls).toHaveLength(0);
  });

  it('OpenAI選択時にAPIキー未設定なら送信しない', async () => {
    await saveSettings({ provider: 'openai' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { createProvider } = await import('../../src/ai/factory');
    const { snap } = await setup({ factory: createProvider });
    await putPending(pending(1));
    await flush();
    expect(snap().displayed?.status).toMatchObject({ kind: 'error', message: expect.stringMatching(/API key/) });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('モデル未ダウンロードならダウンロードを促し、ダウンロード後に続行する', async () => {
    const provider = new FakeProvider();
    provider.availabilityResult = { kind: 'needs-download' };
    const { controller, snap } = await setup({ provider });
    await putPending(pending(1));
    await flush();
    expect(snap().displayed?.status).toEqual({ kind: 'needs-download', inProgress: false });
    expect(provider.calls).toHaveLength(0);

    provider.availabilityResult = { kind: 'available' };
    const done = controller.downloadModel(1);
    await flush();
    expect(provider.prepared).toBe(1);
    provider.answer(0, 'ok');
    await done;
    expect(snap().displayed?.versions).toHaveLength(1);
  });

  it('Chromeが既にダウンロード中ならエラーではなくダウンロード待ちとして表示する', async () => {
    const provider = new FakeProvider();
    provider.availabilityResult = { kind: 'downloading' };
    const { snap } = await setup({ provider });
    await putPending(pending(1));
    await flush();
    expect(snap().displayed?.status).toEqual({ kind: 'needs-download', inProgress: true });
  });

  it('ダウンロードの進捗を公開し、進捗イベントが来なくても利用可否の確認で完了を検出する', async () => {
    vi.useFakeTimers();
    try {
      const provider = new FakeProvider();
      provider.availabilityResult = { kind: 'needs-download' };
      let report: (ratio: number) => void = () => {};
      // create() が返らない（進捗イベントも来ない）状況を再現
      provider.prepareImpl = (onProgress) => {
        report = onProgress;
        return new Promise(() => {});
      };
      const { controller, snap } = await setup({ provider });
      await putPending(pending(1));
      await putPending(pending(2));
      await vi.advanceTimersByTimeAsync(0);

      const done = controller.downloadModel(1);
      expect(snap().download).toMatchObject({ ratio: 0 });
      report(0.25);
      expect(snap().download?.ratio).toBe(0.25);
      // 二重に開始しない
      await controller.downloadModel(2);
      expect(provider.prepared).toBe(1);

      await vi.advanceTimersByTimeAsync(3000);
      expect(provider.calls).toHaveLength(0);
      provider.availabilityResult = { kind: 'available' };
      await vi.advanceTimersByTimeAsync(3000);
      expect(snap().download).toBeNull();
      // ダウンロード待ちだった両方のタブが実行される
      expect(provider.calls.map((c) => c.request.sourceText).sort()).toEqual(['text 1', 'text 2']);
      provider.answer(0, 'ok');
      provider.answer(1, 'ok');
      await done;
    } finally {
      vi.useRealTimers();
    }
  });

  it('ダウンロードに失敗したらエラーを表示する', async () => {
    const provider = new FakeProvider();
    provider.availabilityResult = { kind: 'needs-download' };
    provider.prepareImpl = async () => {
      throw new Error('NotAllowedError');
    };
    const { controller, snap } = await setup({ provider });
    await putPending(pending(1));
    await flush();
    await controller.downloadModel(1);
    expect(snap().displayed?.status).toMatchObject({ kind: 'error', message: expect.stringMatching(/NotAllowedError/) });
    expect(snap().download).toBeNull();
  });

  it('入力が長すぎる場合は実行しない', async () => {
    const provider = new FakeProvider();
    provider.inputCheck = { ok: false, limit: 100, unit: 'chars' };
    const { snap } = await setup({ provider });
    await putPending(pending(1));
    await flush();
    expect(snap().displayed?.status).toEqual({ kind: 'too-long', limit: 100 });
    expect(provider.calls).toHaveLength(0);
  });

  it('AIのエラーを表示し、再実行できる', async () => {
    const { provider, controller, snap } = await setup();
    await putPending(pending(1));
    await flush();
    provider.calls[0].reject(new Error('壊れた応答'));
    await flush();
    expect(snap().displayed?.status).toEqual({ kind: 'error', message: '壊れた応答' });
    const retry = controller.retry(1);
    await flush();
    provider.answer(1, 'ok');
    await retry;
    expect(snap().displayed?.status.kind).toBe('idle');
  });

  it('拡張機能の再読み込みで chrome API が消えていても dispose は例外を出さない', async () => {
    const { controller } = await setup();
    (globalThis as { chrome?: unknown }).chrome = {};
    expect(() => controller.dispose()).not.toThrow();
  });

  it('ウィンドウを開き直すとセッションを復元し、実行中だったものは中断扱いにする', async () => {
    const first = await setup();
    await putPending(pending(1, 'done'));
    await flush();
    first.provider.answer(0, 'DONE');
    await flush();
    await putPending(pending(2, 'running'));
    await flush();
    first.controller.dispose();

    fakeChrome().tabs.activeTabId = 1;
    const { snap } = await setup();
    const byTab = new Map(snap().sessions.map((s) => [s.source.tabId, s.status.kind]));
    expect(byTab).toEqual(new Map([[1, 'idle'], [2, 'interrupted']]));
    // アクティブタブのセッションを表示する
    expect(snap().displayed?.source.tabId).toBe(1);
  });

  describe('間違いの記録と復習クイズ', () => {
    const ORIGINAL = 'We finally had went back to home.';
    const REVISED = 'We finally went back home.';
    const DAY = 24 * 60 * 60 * 1000;

    async function proofread(provider: FakeProvider, tabId: number, snap: () => ReturnType<KoseController['getSnapshot']>) {
      await putPending(pending(tabId, ORIGINAL, 'en'));
      await flush();
      provider.calls.at(-1)!.resolve({ revisedText: REVISED, detectedSourceLanguage: 'en' });
      await flush();
      provider.explainCalls.at(-1)!.resolve({
        explanation: '',
        changes: [
          { before: 'had went', after: 'went', type: 'objective_error', explanation: '過去完了は不要' },
          { before: 'finally', after: 'finally', type: 'style', explanation: '' },
        ],
        nuanceWarnings: [],
        droppedChanges: 0,
      });
      await flush();
      await flush();
      return snap();
    }

    it('右クリック直後の案の解説から客観的な誤りを記録する', async () => {
      const { provider, snap } = await setup();
      await proofread(provider, 1, snap);
      const cards = await loadMistakes();
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ language: 'en', before: 'had went', after: 'went', count: 1 });
      // 作った日は出題しない
      expect(snap().dueCards).toEqual([]);
    });

    it('同じ間違いをまた検出すると回数を増やし、再発として公開する', async () => {
      const { provider, snap } = await setup();
      await proofread(provider, 1, snap);
      await proofread(provider, 1, snap);
      const cards = await loadMistakes();
      expect(cards).toHaveLength(1);
      expect(cards[0].count).toBe(2);
      expect(cards[0].review.repetitions).toBe(0);
      expect(snap().cards.map((c) => c.count)).toEqual([2]);
    });

    it('自動記録をオフにすると記録しない', async () => {
      await saveSettings({ autoSaveMistakes: false });
      const { provider, snap } = await setup();
      await proofread(provider, 1, snap);
      expect(await loadMistakes()).toEqual([]);
    });

    it('新しい実行で期限が来たカードを1枚出し、タブごとに別のカードにする。評価すると期限が延びる', async () => {
      await saveMistakes(
        [
          { language: 'en', before: 'old', after: 'new', explanation: '' },
          { language: 'en', before: 'old2', after: 'new2', explanation: '' },
        ],
        Date.now() - 2 * DAY,
      );
      const { controller, snap } = await setup();
      expect(snap().dueCards).toHaveLength(2);
      expect(snap().quizCard).toBeNull();

      await putPending(pending(1));
      await flush();
      const first = snap().quizCard!;
      expect(first).not.toBeNull();
      await putPending(pending(2));
      await flush();
      const second = snap().quizCard!;
      expect(second.id).not.toBe(first.id);

      await controller.rateCard(second.id, 'good');
      expect(snap().dueCards.map((c) => c.id)).toEqual([first.id]);
      // 評価したカードも、その実行の間は表示を続ける
      expect(snap().quizCard?.id).toBe(second.id);
      expect(snap().quizCard!.review.dueAt).toBeGreaterThan(Date.now());
    });

    it('期限が来たカードがない、または設定でオフなら出さない', async () => {
      await saveMistakes([{ language: 'en', before: 'old', after: 'new', explanation: '' }], Date.now());
      const { snap, controller } = await setup();
      await putPending(pending(1));
      await flush();
      expect(snap().quizCard).toBeNull();

      await saveMistakes([{ language: 'en', before: 'a', after: 'b', explanation: '' }], Date.now() - 2 * DAY);
      await controller.updateSettings({ quizWhileWaiting: false });
      await putPending(pending(1));
      await flush();
      expect(snap().quizCard).toBeNull();
      expect(snap().dueCards).toHaveLength(1);
    });
  });

  describe('自由入力', () => {
    it('セッションがなければ自由入力を表示する', async () => {
      const { snap } = await setup();
      expect(snap().displayedTabId).toBe(SCRATCH_TAB_ID);
      expect(snap().displayed).toBeNull();
      expect(snap().scratch.draft).toBe('');
    });

    it('下書きを storage.session に保存し、開き直すと復元する', async () => {
      const { controller } = await setup();
      controller.setScratchDraft('draft text');
      await flush();
      expect(fakeChrome().storage.session.data.scratchDraft).toBe('draft text');
      expect(fakeChrome().storage.local.data.scratchDraft).toBeUndefined();
      const { snap } = await setup();
      expect(snap().scratch.draft).toBe('draft text');
    });

    it('実行すると最後に選んだ機能で自由入力のセッションを作り、下書きは残す', async () => {
      await saveSettings({ targetLanguage: 'ja' });
      const { controller, provider, snap } = await setup();
      controller.setScratchDraft('\n  Hello wrld.\n\n');
      void controller.runScratch();
      await flush();
      expect(provider.calls[0].request).toMatchObject({ sourceText: '  Hello wrld.', targetLanguage: 'ja' });
      expect(snap().displayedTabId).toBe(SCRATCH_TAB_ID);
      expect(snap().displayed?.source).toMatchObject({ tabId: SCRATCH_TAB_ID, tabTitle: 'Free input' });
      expect(snap().scratch.draft).toBe('\n  Hello wrld.\n\n');

      provider.answer(0, 'Hello world.');
      await flush();
      expect(snap().displayed?.versions[0].result.revisedText).toBe('Hello world.');
    });

    it('空の下書きは実行しない', async () => {
      const { controller, provider } = await setup();
      controller.setScratchDraft('   \n ');
      await controller.runScratch();
      expect(provider.calls).toHaveLength(0);
    });

    it('選択なしで実行された合図を受けると、表示中のレビューから自由入力に切り替えてフォーカスさせる', async () => {
      const { snap } = await setup();
      await putPending(pending(1));
      await flush();
      expect(snap().displayedTabId).toBe(1);
      const seq = snap().scratch.focusSeq;

      await requestScratch();
      await flush();
      await flush();
      expect(snap().displayedTabId).toBe(SCRATCH_TAB_ID);
      expect(snap().scratch.focusSeq).toBe(seq + 1);
      expect(fakeChrome().storage.session.data.scratchRequest).toBeUndefined();
    });

    it('ウィンドウが開く前の合図も起動時に処理する。ページからの実行の方が新しければそちらを表示する', async () => {
      await putPending(pending(1));
      await requestScratch();
      const { snap } = await setup();
      expect(snap().displayedTabId).toBe(SCRATCH_TAB_ID);
      expect(snap().scratch.focusSeq).toBe(1);
      expect(fakeChrome().storage.session.data.scratchRequest).toBeUndefined();

      await requestScratch(0);
      await putPending(pending(2));
      const second = await setup();
      await flush();
      expect(second.snap().displayedTabId).toBe(2);
    });

    it('自由入力はタブの切り替えで消えず、セッション一覧から選べる', async () => {
      const { controller, snap } = await setup();
      controller.setScratchDraft('memo');
      void controller.runScratch();
      await putPending(pending(1));
      await flush();
      expect(snap().displayedTabId).toBe(1);
      controller.showSession(SCRATCH_TAB_ID);
      expect(snap().displayedTabId).toBe(SCRATCH_TAB_ID);
      expect(snap().displayed?.sourceText).toBe('memo');
      controller.onTabRemoved(1);
      expect(snap().sessions.map((s) => s.source.tabId)).toEqual([SCRATCH_TAB_ID]);
    });
  });
});
