import { launchFromClipboard, readClipboard } from './launch';

// 処理が済んだら、このページのタブを閉じる（koseウィンドウに文章を渡すためだけのページ）
launchFromClipboard(readClipboard)
  .catch((e) => console.error('kose: failed to launch from the clipboard', e))
  .finally(async () => {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
    else window.close();
  });
