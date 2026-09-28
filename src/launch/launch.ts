import { ensureKoseWindow } from '../background/koseWindow';
import { requestScratch } from '../storage/sessionStore';

/**
 * 外部（chrome.exe "chrome-extension://<ID>/launch.html"）から起動されたときの処理。
 * クリップボードの文章を自由入力に渡して実行させ、koseウィンドウを開くか前面に出す。
 * クリップボードが空なら自由入力を開くだけにする。
 */
export async function launchFromClipboard(readClipboard: () => Promise<string>): Promise<void> {
  let text = '';
  try {
    text = await readClipboard();
  } catch {
    // 読めなければ自由入力を開くだけにする
  }
  await requestScratch(Date.now(), text.trim() === '' ? undefined : text);
  await ensureKoseWindow(true);
}

/**
 * クリップボードの文章を読む。readText はページにフォーカスが無いと失敗するので、
 * clipboardRead 権限で使える execCommand('paste') でも試す。
 */
export async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    const area = document.createElement('textarea');
    document.body.append(area);
    area.focus();
    document.execCommand('paste');
    const text = area.value;
    area.remove();
    return text;
  }
}
