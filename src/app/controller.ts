import type { AIProvider } from '../ai/provider';
import {
  addVersion,
  appendMessage,
  buildChatRequest,
  createSession,
  displayedTabAfterActivation,
  markInterrupted,
  selectVersion,
  setExplanation,
} from '../domain/session';
import type { PartialExplanation, PendingRequest, ReviewSession, SessionStatus } from '../domain/types';
import { needsStructureReview } from '../domain/structure';
import { newId } from '../shared/ids';
import { isPendingKey, loadAll, saveSession, takePending } from '../storage/sessionStore';
import { loadSettings, onSettingsChanged, saveSettings, Settings } from '../storage/settings';

export interface DownloadState {
  /** 0〜1。Chromeから進捗が届いていなければ 0 */
  ratio: number;
  startedAt: number;
}

/** 進捗イベントが来なくても完了に気づけるよう、利用可否を確認する間隔 */
const DOWNLOAD_POLL_MS = 3000;

export type ProviderFactory = (settings: Settings) => AIProvider;

/** ニュアンス相談の状況。タブ単位でメモリにだけ持つ */
export type ChatState = { kind: 'running'; startedAt: number; partial?: string } | { kind: 'error'; message: string };

/** 解説（2段目）の生成状況。バージョン単位でメモリにだけ持つ */
export type ExplainState =
  | { kind: 'running'; startedAt: number; partial?: PartialExplanation }
  | { kind: 'error'; message: string };

export interface ControllerSnapshot {
  settings: Settings;
  /** 新しい順 */
  sessions: ReviewSession[];
  displayed: ReviewSession | null;
  /** Chrome内蔵モデルのダウンロード状況。ダウンロード中でなければ null */
  download: DownloadState | null;
  /** 表示中セッションの生成途中の改稿文。生成中でなければ null */
  partialText: string | null;
  /** バージョンIDごとの解説の生成状況（生成済み・未生成のものは含まない） */
  explainStates: Readonly<Record<string, ExplainState>>;
  /** 表示中セッションの相談の状況。何もしていなければ null */
  chatState: ChatState | null;
}

/**
 * koseウィンドウの状態管理。右クリック要求の受け取り、AI実行、
 * タブ単位のセッション、アクティブタブへの追従を担う。
 */
export class KoseController {
  private settings!: Settings;
  private readonly sessions = new Map<number, ReviewSession>();
  private readonly aborts = new Map<number, AbortController>();
  private displayedTabId: number | null = null;
  private ownWindowId: number | undefined;
  private download: DownloadState | null = null;
  /** 生成途中の改稿文（タブ単位）。頻繁に変わるので storage には保存しない */
  private readonly partials = new Map<number, string>();
  private readonly explainStates = new Map<string, ExplainState>();
  private readonly explainAborts = new Map<string, AbortController>();
  private readonly chatStates = new Map<number, ChatState>();
  private readonly chatAborts = new Map<number, AbortController>();
  private snapshot: ControllerSnapshot | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly providerFactory: ProviderFactory) {}

  async init(): Promise<void> {
    this.settings = await loadSettings();
    this.ownWindowId = (await chrome.windows.getCurrent()).id;
    // 読み込み中に届いた要求を取りこぼさないよう、先に購読する（重複は acceptPending が除く）
    this.listen();

    const { pending, sessions } = await loadAll();
    for (const s of sessions) {
      if (this.sessions.has(s.source.tabId)) continue;
      const restored = markInterrupted(s);
      this.sessions.set(s.source.tabId, restored);
      if (restored !== s) void saveSession(restored);
    }
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active?.id !== undefined && this.sessions.has(active.id)) this.displayedTabId = active.id;
    else this.displayedTabId ??= this.newestSession()?.source.tabId ?? null;
    this.emit();

    // AIの完了は待たない（初期化を塞がない）
    for (const req of pending.sort((a, b) => a.createdAt - b.createdAt)) void this.acceptPending(req);
    this.prewarm();
  }

  /** 右クリック前にAIの準備（プロンプトの読み込み）を済ませておく */
  private prewarm(): void {
    const provider = this.providerFactory(this.settings);
    provider.prewarm?.(this.settings.targetLanguage).catch(() => {
      // 準備に失敗しても、実行時に改めて作るので無視する
    });
  }

  dispose(): void {
    for (const d of this.disposers) {
      try {
        d();
      } catch {
        // 拡張機能の再読み込みでページが破棄されるときは chrome.* がもう使えない。後片付けなので無視する
      }
    }
    for (const a of this.aborts.values()) a.abort();
    for (const a of this.explainAborts.values()) a.abort();
    for (const a of this.chatAborts.values()) a.abort();
  }

  // ---- React (useSyncExternalStore) 向け ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ControllerSnapshot | null => this.snapshot;

  // ---- イベント ----

  async acceptPending(req: PendingRequest): Promise<void> {
    const tabId = req.source.tabId;
    const existing = this.sessions.get(tabId);
    // 同じ要求を二重に処理しない（onChanged と起動時読み込みの競合）
    if (existing && existing.id === req.requestId) {
      await takePending(tabId, req.requestId);
      return;
    }

    this.aborts.get(tabId)?.abort();
    this.abortExplains(existing);
    this.abortChat(tabId);
    this.sessions.set(tabId, createSession(req, this.settings.situation));
    this.displayedTabId = tabId;
    this.emit();
    await takePending(tabId, req.requestId);
    if (this.settings.targetLanguage !== req.targetLanguage) {
      this.settings = await saveSettings({ targetLanguage: req.targetLanguage });
    }
    await this.run(tabId);
  }

  onTabActivated(info: { tabId: number; windowId: number }): void {
    if (info.windowId === this.ownWindowId) return;
    const next = displayedTabAfterActivation(this.sessions, this.displayedTabId, info.tabId);
    if (next !== this.displayedTabId) {
      this.displayedTabId = next;
      this.emit();
    }
  }

  onTabRemoved(tabId: number): void {
    this.aborts.get(tabId)?.abort();
    this.aborts.delete(tabId);
    this.partials.delete(tabId);
    this.abortExplains(this.sessions.get(tabId));
    this.abortChat(tabId);
    if (!this.sessions.delete(tabId)) return;
    if (this.displayedTabId === tabId) this.displayedTabId = this.newestSession()?.source.tabId ?? null;
    this.emit();
  }

  // ---- UI操作 ----

  showSession(tabId: number): void {
    if (!this.sessions.has(tabId)) return;
    this.displayedTabId = tabId;
    this.emit();
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = await saveSettings(patch);
    this.emit();
    if (patch.targetLanguage || patch.provider) this.prewarm();
  }

  /** 下部の設定で同じ原文を再生成する */
  async regenerate(tabId: number): Promise<void> {
    const session = this.sessions.get(tabId);
    if (!session) return;
    this.update(tabId, {
      ...session,
      targetLanguage: this.settings.targetLanguage,
      situation: this.settings.situation,
    });
    await this.run(tabId);
  }

  async retry(tabId: number): Promise<void> {
    await this.run(tabId);
  }

  selectVersion(tabId: number, versionId: string): void {
    const session = this.sessions.get(tabId);
    if (session) this.update(tabId, selectVersion(session, versionId));
  }

  /**
   * Chrome内蔵モデルのダウンロード。ボタンのクリックから呼ぶこと（ユーザー操作が必要）。
   * 完了したら、ダウンロード待ちだったすべてのセッションを実行する。
   */
  async downloadModel(tabId: number): Promise<void> {
    const session = this.sessions.get(tabId);
    const provider = this.providerFactory(this.settings);
    if (!session || !provider.prepare || this.download) return;
    const target = session.targetLanguage;
    this.download = { ratio: 0, startedAt: Date.now() };
    this.emit();

    let finished = false;
    const prepared = provider.prepare(target, (ratio) => {
      if (finished || !this.download) return;
      this.download = { ...this.download, ratio };
      this.emit();
    });
    // 進捗イベントが届かない環境もあるため、利用可否の確認でも完了を検出する
    const polled = (async () => {
      while (!finished) {
        await new Promise((r) => setTimeout(r, DOWNLOAD_POLL_MS));
        if (!finished && (await provider.availability(target)).kind === 'available') return;
      }
    })();
    try {
      await Promise.race([prepared, polled]);
    } catch (e) {
      this.setStatus(tabId, { kind: 'error', message: `モデルをダウンロードできませんでした: ${errorMessage(e)}` });
      return;
    } finally {
      finished = true;
      prepared.catch(() => {}); // 確認側が先に完了した場合の後続の失敗は無視
      this.download = null;
      this.emit();
    }
    const waiting = [...this.sessions.values()].filter((s) => s.status.kind === 'needs-download');
    await Promise.all(waiting.map((s) => this.run(s.source.tabId)));
  }

  /** 2段目: 指定したバージョン（省略時は表示中の案）の解説を生成する */
  async explain(tabId: number, versionId?: string): Promise<void> {
    const session = this.sessions.get(tabId);
    const version = session?.versions.find((v) => v.id === (versionId ?? session.currentVersionId));
    if (!session || !version || version.explanation || this.explainStates.get(version.id)?.kind === 'running') return;

    const abort = new AbortController();
    this.explainAborts.set(version.id, abort);
    const startedAt = Date.now();
    this.explainStates.set(version.id, { kind: 'running', startedAt });
    this.emit();
    const provider = this.providerFactory(this.settings);
    try {
      const explanation = await provider.explain(
        {
          requestId: newId(),
          sourceText: session.sourceText,
          revisedText: version.result.revisedText,
          targetLanguage: version.targetLanguage,
          situation: version.situation,
          reviewStructure: needsStructureReview(version.result.revisedText),
        },
        abort.signal,
        (partial) => {
          if (abort.signal.aborted) return;
          this.explainStates.set(version.id, { kind: 'running', startedAt, partial });
          this.emit();
        },
      );
      const latest = this.sessions.get(tabId);
      if (abort.signal.aborted || latest?.id !== session.id) return;
      this.explainStates.delete(version.id);
      this.update(
        tabId,
        setExplanation(latest, version.id, { ...explanation, provider: provider.id, durationMs: Date.now() - startedAt }),
      );
    } catch (e) {
      if (abort.signal.aborted) return;
      this.explainStates.set(version.id, { kind: 'error', message: errorMessage(e) });
      this.emit();
    } finally {
      if (this.explainAborts.get(version.id) === abort) this.explainAborts.delete(version.id);
    }
  }

  /** ニュアンス相談: 表示中の案について質問・依頼する */
  async sendChat(tabId: number, text: string): Promise<void> {
    const message = text.trim();
    const session = this.sessions.get(tabId);
    if (!message || !session?.currentVersionId || session.status.kind === 'running') return;
    if (this.chatStates.get(tabId)?.kind === 'running') return;
    this.update(tabId, appendMessage(session, { role: 'user', content: message }));
    await this.runChat(tabId);
  }

  /** 失敗した相談を送り直す（最後のユーザー発言をもう一度問い合わせる） */
  async retryChat(tabId: number): Promise<void> {
    if (this.chatStates.get(tabId)?.kind !== 'error') return;
    await this.runChat(tabId);
  }

  // ---- 内部 ----

  private async runChat(tabId: number): Promise<void> {
    const session = this.sessions.get(tabId);
    const last = session?.messages.at(-1);
    if (!session || last?.role !== 'user') return;
    const request = buildChatRequest({ ...session, messages: session.messages.slice(0, -1) }, last.content, newId());
    const current = session.versions.find((v) => v.id === session.currentVersionId);
    if (!request || !current) return;

    this.abortChat(tabId);
    const abort = new AbortController();
    this.chatAborts.set(tabId, abort);
    const startedAt = Date.now();
    this.chatStates.set(tabId, { kind: 'running', startedAt });
    this.emit();
    const provider = this.providerFactory(this.settings);
    try {
      const reply = await provider.chat(request, abort.signal, (partial) => {
        if (abort.signal.aborted) return;
        this.chatStates.set(tabId, { kind: 'running', startedAt, partial });
        this.emit();
      });
      const latest = this.sessions.get(tabId);
      if (abort.signal.aborted || latest?.id !== session.id) return;
      this.chatStates.delete(tabId);

      let next = latest;
      if (reply.revisedText !== undefined) {
        // 新しい改稿案は、相談を始めたときの案の設定で追加する
        next = addVersion(
          next,
          { revisedText: reply.revisedText, detectedSourceLanguage: current.result.detectedSourceLanguage, usage: reply.usage },
          current,
          Date.now(),
          { provider: provider.id, durationMs: Date.now() - startedAt, origin: 'chat' },
        );
      }
      next = appendMessage(next, {
        role: 'assistant',
        content: reply.replyJa,
        versionId: reply.revisedText !== undefined ? next.currentVersionId! : undefined,
        usage: reply.usage,
      });
      this.update(tabId, next);
      if (reply.revisedText !== undefined && (!provider.sendsExternally || this.settings.autoExplainCloud)) {
        void this.explain(tabId, next.currentVersionId!);
      }
    } catch (e) {
      if (abort.signal.aborted) return;
      this.chatStates.set(tabId, { kind: 'error', message: errorMessage(e) });
      this.emit();
    } finally {
      if (this.chatAborts.get(tabId) === abort) this.chatAborts.delete(tabId);
    }
  }

  private abortChat(tabId: number): void {
    this.chatAborts.get(tabId)?.abort();
    this.chatAborts.delete(tabId);
    this.chatStates.delete(tabId);
  }

  private abortExplains(session: ReviewSession | undefined): void {
    for (const v of session?.versions ?? []) {
      this.explainAborts.get(v.id)?.abort();
      this.explainAborts.delete(v.id);
      this.explainStates.delete(v.id);
    }
  }

  private async run(tabId: number): Promise<void> {
    const session = this.sessions.get(tabId);
    if (!session) return;
    this.aborts.get(tabId)?.abort();
    const abort = new AbortController();
    this.aborts.set(tabId, abort);

    const requestId = newId();
    const request = {
      requestId,
      sourceText: session.sourceText,
      targetLanguage: session.targetLanguage,
      situation: session.situation,
    };
    this.partials.delete(tabId);
    this.setStatus(tabId, { kind: 'running', requestId, startedAt: Date.now() });
    // 自分の要求がまだ最新か（新しい右クリック・タブを閉じる・再実行で無効になる）
    const isCurrent = () => {
      const s = this.sessions.get(tabId);
      return !abort.signal.aborted && s?.status.kind === 'running' && s.status.requestId === requestId;
    };

    const provider = this.providerFactory(this.settings);
    try {
      const availability = await provider.availability(request.targetLanguage);
      if (!isCurrent()) return;
      if (availability.kind === 'needs-download' || availability.kind === 'downloading') {
        return this.setStatus(tabId, { kind: 'needs-download', inProgress: availability.kind === 'downloading' });
      }
      if (availability.kind === 'unavailable') {
        return this.setStatus(tabId, { kind: 'error', message: availability.reason });
      }

      const check = await provider.checkInput(request);
      if (!isCurrent()) return;
      if (!check.ok) return this.setStatus(tabId, { kind: 'too-long', limit: check.limit });

      const startedAt = Date.now();
      const output = await provider.rewrite(request, abort.signal, (partial) => {
        if (!isCurrent()) return;
        this.partials.set(tabId, partial);
        this.emit();
      });
      if (!isCurrent()) return;
      const latest = this.sessions.get(tabId)!;
      const now = Date.now();
      const next = addVersion(latest, output, request, now, { provider: provider.id, durationMs: now - startedAt });
      this.update(tabId, next);
      // 解説は、無料のChrome内蔵AIなら自動で、クラウドなら設定で自動にしたときだけ続けて生成する
      if (!provider.sendsExternally || this.settings.autoExplainCloud) void this.explain(tabId, next.currentVersionId!);
    } catch (e) {
      if (!isCurrent()) return;
      this.setStatus(tabId, { kind: 'error', message: errorMessage(e) });
    } finally {
      if (this.aborts.get(tabId) === abort) {
        this.aborts.delete(tabId);
        this.partials.delete(tabId);
      }
    }
  }

  private setStatus(tabId: number, status: SessionStatus): void {
    const session = this.sessions.get(tabId);
    if (session) this.update(tabId, { ...session, status });
  }

  private update(tabId: number, session: ReviewSession): void {
    if (!this.sessions.has(tabId)) return; // タブが閉じられた後の結果は捨てる
    this.sessions.set(tabId, session);
    void saveSession(session);
    this.emit();
  }

  private newestSession(): ReviewSession | undefined {
    return this.sortedSessions()[0];
  }

  private sortedSessions(): ReviewSession[] {
    return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  private listen(): void {
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session') return;
      for (const [key, change] of Object.entries(changes)) {
        if (isPendingKey(key) && change.newValue) void this.acceptPending(change.newValue as PendingRequest);
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    this.disposers.push(() => chrome.storage.onChanged.removeListener(onStorage));

    const onActivated = (info: { tabId: number; windowId: number }) => this.onTabActivated(info);
    chrome.tabs.onActivated.addListener(onActivated);
    this.disposers.push(() => chrome.tabs.onActivated.removeListener(onActivated));

    const onRemoved = (tabId: number) => this.onTabRemoved(tabId);
    chrome.tabs.onRemoved.addListener(onRemoved);
    this.disposers.push(() => chrome.tabs.onRemoved.removeListener(onRemoved));

    this.disposers.push(
      onSettingsChanged((settings) => {
        this.settings = settings;
        this.emit();
      }),
    );
  }

  private emit(): void {
    this.snapshot = {
      settings: this.settings,
      sessions: this.sortedSessions(),
      displayed: this.displayedTabId === null ? null : (this.sessions.get(this.displayedTabId) ?? null),
      download: this.download,
      partialText: this.displayedTabId === null ? null : (this.partials.get(this.displayedTabId) ?? null),
      explainStates: Object.fromEntries(this.explainStates),
      chatState: this.displayedTabId === null ? null : (this.chatStates.get(this.displayedTabId) ?? null),
    };
    for (const l of this.listeners) l();
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
