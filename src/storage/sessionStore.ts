import type { PendingRequest, ReviewSession } from '../domain/types';

// chrome.storage.session はメモリ上にだけ保持され、ブラウザ終了で消える。
// キーはタブ単位に分け、service worker と koseウィンドウの書き込みが衝突しないようにする。

const PENDING_PREFIX = 'pending:';
const SESSION_PREFIX = 'session:';
const WINDOW_KEY = 'koseWindowId';
/**
 * koseウィンドウに自由入力を開かせる合図。選択なしで実行されたときと、外部から起動用ページで
 * クリップボードの文章を渡されたとき（text あり。そのまま実行する）に書く
 */
export const SCRATCH_REQUEST_KEY = 'scratchRequest';
/** 自由入力の下書き。本文をディスクに書かないため session に置く */
const SCRATCH_DRAFT_KEY = 'scratchDraft';

export const pendingKey = (tabId: number) => `${PENDING_PREFIX}${tabId}`;
export const sessionKey = (tabId: number) => `${SESSION_PREFIX}${tabId}`;

export async function putPending(req: PendingRequest): Promise<void> {
  await chrome.storage.session.set({ [pendingKey(req.source.tabId)]: req });
}

export async function takePending(tabId: number, requestId: string): Promise<void> {
  const key = pendingKey(tabId);
  const stored = await chrome.storage.session.get(key);
  // 処理中に同じタブで新しい要求が来ていたら消さない
  if ((stored[key] as PendingRequest | undefined)?.requestId === requestId) {
    await chrome.storage.session.remove(key);
  }
}

export async function saveSession(session: ReviewSession): Promise<void> {
  await chrome.storage.session.set({ [sessionKey(session.source.tabId)]: session });
}

export async function loadAll(): Promise<{ pending: PendingRequest[]; sessions: ReviewSession[] }> {
  const all = await chrome.storage.session.get(null);
  const pending: PendingRequest[] = [];
  const sessions: ReviewSession[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(PENDING_PREFIX)) pending.push(value as PendingRequest);
    else if (key.startsWith(SESSION_PREFIX)) sessions.push(value as ReviewSession);
  }
  return { pending, sessions };
}

/** タブが閉じられたらそのタブの一時データを消す */
export async function removeTabData(tabId: number): Promise<void> {
  await chrome.storage.session.remove([pendingKey(tabId), sessionKey(tabId)]);
}

export function isPendingKey(key: string): boolean {
  return key.startsWith(PENDING_PREFIX);
}

export async function getKoseWindowId(): Promise<number | undefined> {
  const stored = await chrome.storage.session.get(WINDOW_KEY);
  return stored[WINDOW_KEY] as number | undefined;
}

export async function setKoseWindowId(id: number): Promise<void> {
  await chrome.storage.session.set({ [WINDOW_KEY]: id });
}

export interface ScratchRequest {
  at: number;
  /** 自由入力に入れて実行する文章 */
  text?: string;
}

export async function requestScratch(now = Date.now(), text?: string): Promise<void> {
  const request: ScratchRequest = text === undefined ? { at: now } : { at: now, text };
  await chrome.storage.session.set({ [SCRATCH_REQUEST_KEY]: request });
}

/** 自由入力を開く合図を取り出して消す */
export async function takeScratchRequest(): Promise<ScratchRequest | undefined> {
  const stored = await chrome.storage.session.get(SCRATCH_REQUEST_KEY);
  const raw = stored[SCRATCH_REQUEST_KEY] as ScratchRequest | number | undefined;
  if (raw === undefined) return undefined;
  await chrome.storage.session.remove(SCRATCH_REQUEST_KEY);
  if (typeof raw === 'number') return { at: raw };
  return { at: typeof raw.at === 'number' ? raw.at : 0, text: typeof raw.text === 'string' ? raw.text : undefined };
}

export async function loadScratchDraft(): Promise<string> {
  const stored = await chrome.storage.session.get(SCRATCH_DRAFT_KEY);
  const draft = stored[SCRATCH_DRAFT_KEY];
  return typeof draft === 'string' ? draft : '';
}

export async function saveScratchDraft(draft: string): Promise<void> {
  await chrome.storage.session.set({ [SCRATCH_DRAFT_KEY]: draft });
}
