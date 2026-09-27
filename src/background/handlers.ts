import type { LanguageCode, PendingRequest, SourceLocation } from '../domain/types';
import { newId } from '../shared/ids';
import { putPending, removeTabData } from '../storage/sessionStore';
import { loadSettings } from '../storage/settings';
import { captureSelection } from './capture';
import { ensureKoseWindow } from './koseWindow';

export const MENU_ROOT = 'kose';
export const MENU_TARGETS: Record<string, LanguageCode> = {
  'kose-ja': 'ja',
  'kose-en': 'en',
};

export function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ROOT, title: 'kose', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'kose-ja', parentId: MENU_ROOT, title: 'よい日本語にする', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'kose-en', parentId: MENU_ROOT, title: 'よい英語にする', contexts: ['selection'] });
  });
}

export async function handleMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<PendingRequest | null> {
  const targetLanguage = MENU_TARGETS[String(info.menuItemId)];
  const tabId = tab?.id;
  if (!targetLanguage || tabId === undefined || tabId < 0) return null;

  const frameId = info.frameId ?? 0;
  const fallback = info.selectionText ?? '';
  let text = fallback;
  let source: SourceLocation = {
    tabId,
    frameId,
    tabTitle: tab?.title,
    textSource: 'selectionText',
    editable: info.editable,
  };

  // activeTab によりクリックされたタブへ注入できる。PDFビューア・Chrome内部ページでは失敗する
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: captureSelection,
    });
    const captured = injection?.result;
    if (captured && captured.text.trim() !== '') {
      text = captured.text;
      source = {
        ...source,
        documentId: injection.documentId,
        textSource: 'script',
        editable: captured.editable,
      };
    }
  } catch {
    // selectionText のまま続行する（改行が失われている可能性をUIで表示）
  }

  text = trimSelection(text);
  if (text === '') return null;

  const req: PendingRequest = {
    requestId: newId(),
    targetLanguage,
    text,
    source,
    createdAt: Date.now(),
  };
  await putPending(req);
  const settings = await loadSettings();
  await ensureKoseWindow(settings.focusOnInvoke);
  return req;
}

export async function handleTabRemoved(tabId: number): Promise<void> {
  await removeTabData(tabId);
}

/** 選択範囲の先頭の空行と末尾の空白・改行を除く（1行目のインデントは残す） */
export function trimSelection(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
}
