import { describe, expect, it } from 'vitest';
import { createMenus, handleMenuClick, handleTabRemoved, trimSelection } from '../../src/background/handlers';
import { saveBoundsIfKose } from '../../src/background/koseWindow';
import type { PendingRequest } from '../../src/domain/types';
import { saveSettings } from '../../src/storage/settings';
import { fakeChrome } from '../fakeChrome';

const click = (menuItemId: string, extra: Partial<chrome.contextMenus.OnClickData> = {}) =>
  ({ menuItemId, editable: false, pageUrl: 'https://example.com/', selectionText: 'Hello world', frameId: 0, ...extra }) as chrome.contextMenus.OnClickData;
const tab = (id: number, title = `Tab ${id}`) => ({ id, title }) as chrome.tabs.Tab;

describe('context menu', () => {
  it('kose の下に「よい日本語にする」「よい英語にする」を作る', () => {
    createMenus();
    const titles = fakeChrome().contextMenus.created.map((m) => (m as { title: string }).title);
    expect(titles).toEqual(['kose', 'よい日本語にする', 'よい英語にする']);
  });
});

describe('handleMenuClick', () => {
  it('スクリプトで改行付きの選択文字列を取得して pending request を書き、ウィンドウを開く', async () => {
    const c = fakeChrome();
    c.scripting.executeScript = async () => [
      { result: { text: 'Line 1\nLine 2', editable: true }, documentId: 'doc-1', frameId: 0 },
    ];
    const req = await handleMenuClick(click('kose-ja', { selectionText: 'Line 1 Line 2' }), tab(7, 'GitHub'));
    expect(req).not.toBeNull();
    const stored = c.storage.session.data['pending:7'] as PendingRequest;
    expect(stored).toMatchObject({
      targetLanguage: 'ja',
      text: 'Line 1\nLine 2',
      source: { tabId: 7, frameId: 0, documentId: 'doc-1', tabTitle: 'GitHub', textSource: 'script', editable: true },
    });
    const windows = [...c.windows.all.values()];
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ type: 'popup', url: 'chrome-extension://kose-test/kose.html' });
  });

  it('スクリプトを注入できないページでは selectionText にフォールバックする', async () => {
    const c = fakeChrome();
    await handleMenuClick(click('kose-en'), tab(3));
    expect(c.storage.session.data['pending:3']).toMatchObject({
      text: 'Hello world',
      source: { textSource: 'selectionText' },
    });
  });

  it('既存のkoseウィンドウは再利用し、前面に出す', async () => {
    const c = fakeChrome();
    await handleMenuClick(click('kose-en'), tab(1));
    await handleMenuClick(click('kose-en'), tab(2));
    expect(c.windows.all.size).toBe(1);
    expect([...c.windows.all.values()][0].focused).toBe(true);
  });

  it('連続クリックでもウィンドウは1枚', async () => {
    const c = fakeChrome();
    await Promise.all([handleMenuClick(click('kose-en'), tab(1)), handleMenuClick(click('kose-ja'), tab(2))]);
    expect(c.windows.all.size).toBe(1);
  });

  it('前面に出さない設定なら focused を変えない', async () => {
    const c = fakeChrome();
    await handleMenuClick(click('kose-en'), tab(1));
    const win = [...c.windows.all.values()][0];
    win.focused = false;
    await saveSettings({ focusOnInvoke: false });
    await handleMenuClick(click('kose-en'), tab(2));
    expect(win.focused).toBe(false);
  });

  it('kose以外のメニューや空の選択は無視する', async () => {
    const c = fakeChrome();
    expect(await handleMenuClick(click('other'), tab(1))).toBeNull();
    expect(await handleMenuClick(click('kose-en', { selectionText: '   ' }), tab(1))).toBeNull();
    expect(Object.keys(c.storage.session.data)).toEqual([]);
    expect(c.windows.all.size).toBe(0);
  });

  it('タブを閉じるとそのタブの一時データを消す', async () => {
    const c = fakeChrome();
    await handleMenuClick(click('kose-en'), tab(1));
    await handleMenuClick(click('kose-en'), tab(2));
    c.storage.session.data['session:1'] = { dummy: true };
    await handleTabRemoved(1);
    expect(Object.keys(c.storage.session.data).sort()).toEqual(['koseWindowId', 'pending:2']);
  });

  it('koseウィンドウの位置・サイズを保存し、次回作成時に使う', async () => {
    const c = fakeChrome();
    await handleMenuClick(click('kose-en'), tab(1));
    const win = [...c.windows.all.values()][0];
    await saveBoundsIfKose({ ...win, left: 10, top: 20, width: 500, height: 900 } as chrome.windows.Window);
    c.windows.all.clear();
    await handleMenuClick(click('kose-en'), tab(1));
    expect([...c.windows.all.values()][0]).toMatchObject({ left: 10, top: 20, width: 500, height: 900 });
  });
});

describe('trimSelection', () => {
  it('先頭の空行と末尾の空白・改行を除き、1行目のインデントは残す', () => {
    expect(trimSelection('\n\n  code();\n  more();\n\n')).toBe('  code();\n  more();');
    expect(trimSelection('Hello.\n\n')).toBe('Hello.');
  });
});
