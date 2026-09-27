import type { LanguageCode, PendingRequest, SourceLocation } from '../domain/types';
import { newId } from '../shared/ids';
import { M } from '../shared/messages';
import { trimSelection } from '../domain/text';
import { putPending, removeTabData, requestScratch } from '../storage/sessionStore';
import { loadSettings } from '../storage/settings';
import { captureSelection } from './capture';
import { ensureKoseWindow } from './koseWindow';

export const MENU_ID = 'kose';

/** 右クリックメニュー・ツールバーボタンの表示。最後に選んだ機能を示す */
export function invokeTitle(targetLanguage: LanguageCode): string {
  return M.menu.invokeTitle(M.languages[targetLanguage].target);
}

/** 右クリックは1項目だけにする（2項目以上だと Chrome が拡張名のサブメニューにまとめてしまう） */
export async function createMenus(): Promise<void> {
  const { targetLanguage } = await loadSettings();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: invokeTitle(targetLanguage), contexts: ['selection'] });
  });
  await chrome.action.setTitle({ title: invokeTitle(targetLanguage) });
}

export async function updateInvokeTitles(targetLanguage: LanguageCode): Promise<void> {
  const title = invokeTitle(targetLanguage);
  await Promise.all([chrome.contextMenus.update(MENU_ID, { title }), chrome.action.setTitle({ title })]);
}

export async function handleMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<PendingRequest | null> {
  if (info.menuItemId !== MENU_ID) return null;
  const tabId = tab?.id;
  if (tabId === undefined || tabId < 0) return null;
  const frameId = info.frameId ?? 0;
  const base: SourceLocation = {
    tabId,
    frameId,
    tabTitle: tab?.title,
    textSource: 'selectionText',
    editable: info.editable,
  };
  const captured = await capture({ tabId, frameIds: [frameId] }, base);
  return invoke(captured ?? { text: info.selectionText ?? '', source: base });
}

/**
 * ツールバーボタン・ショートカットから実行する。どのフレームで選択されたか分からないので全フレームを探す。
 * 選択がなければ（取得できないページを含む）koseウィンドウの自由入力を開く。
 */
export async function handleInvoke(tab: chrome.tabs.Tab | undefined): Promise<PendingRequest | null> {
  const tabId = tab?.id;
  const captured =
    tabId !== undefined && tabId >= 0
      ? await capture(
          { tabId, allFrames: true },
          { tabId, frameId: 0, tabTitle: tab?.title, textSource: 'script', editable: false },
        )
      : null;
  const req = captured && (await invoke(captured));
  if (!req) {
    await requestScratch();
    await ensureKoseWindow(true);
  }
  return req;
}

interface Captured {
  text: string;
  source: SourceLocation;
}

/** activeTab によりクリックされたタブへ注入できる。PDFビューア・Chrome内部ページでは失敗する */
async function capture(target: chrome.scripting.InjectionTarget, base: SourceLocation): Promise<Captured | null> {
  try {
    const injections = await chrome.scripting.executeScript({ target, func: captureSelection });
    for (const injection of injections) {
      const captured = injection.result;
      if (!captured || captured.text.trim() === '') continue;
      return {
        text: captured.text,
        source: {
          ...base,
          frameId: injection.frameId ?? base.frameId,
          documentId: injection.documentId,
          textSource: 'script',
          editable: captured.editable,
        },
      };
    }
  } catch {
    // 呼び出し側で selectionText にフォールバックする（改行が失われている可能性をUIで表示）
  }
  return null;
}

/** 最後に選んだ機能（設定の targetLanguage）で pending request を書き、ウィンドウを開く */
async function invoke({ text, source }: Captured): Promise<PendingRequest | null> {
  text = trimSelection(text);
  if (text === '') return null;

  const settings = await loadSettings();
  const req: PendingRequest = {
    requestId: newId(),
    targetLanguage: settings.targetLanguage,
    text,
    source,
    createdAt: Date.now(),
  };
  await putPending(req);
  await ensureKoseWindow(settings.focusOnInvoke);
  return req;
}

export async function handleTabRemoved(tabId: number): Promise<void> {
  await removeTabData(tabId);
}
