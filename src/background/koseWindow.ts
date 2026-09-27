import { getKoseWindowId, setKoseWindowId } from '../storage/sessionStore';
import { M } from '../shared/messages';

export const KOSE_PAGE = 'kose.html';
const BOUNDS_KEY = 'windowBounds';
const DEFAULT_BOUNDS = { width: 460, height: 780 };

interface Bounds {
  left?: number;
  top?: number;
  width: number;
  height: number;
}

let inFlight: Promise<number> | null = null;

/** koseウィンドウを1枚だけ保つ。既存があれば再利用し、なければ作る */
export function ensureKoseWindow(focus: boolean): Promise<number> {
  // 連続した右クリックでウィンドウが2枚できないよう直列化する
  const run = async () => {
    const existing = await findKoseWindow();
    if (existing !== undefined) {
      if (focus) await chrome.windows.update(existing, { focused: true });
      return existing;
    }
    const stored = await chrome.storage.local.get(BOUNDS_KEY);
    const bounds: Bounds = { ...DEFAULT_BOUNDS, ...(stored[BOUNDS_KEY] as Bounds | undefined) };
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL(KOSE_PAGE),
      type: 'popup',
      focused: true,
      ...bounds,
    });
    if (win?.id === undefined) throw new Error(M.window.windowCreateFailed);
    await setKoseWindowId(win.id);
    return win.id;
  };
  const next = (inFlight ?? Promise.resolve(0)).catch(() => 0).then(run);
  inFlight = next;
  return next;
}

export async function findKoseWindow(): Promise<number | undefined> {
  const stored = await getKoseWindowId();
  if (stored !== undefined) {
    try {
      await chrome.windows.get(stored);
      return stored;
    } catch {
      // 閉じられている
    }
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['TAB' as chrome.runtime.ContextType],
    documentUrls: [chrome.runtime.getURL(KOSE_PAGE)],
  });
  const found = contexts.find((c) => c.windowId >= 0)?.windowId;
  if (found !== undefined) await setKoseWindowId(found);
  return found;
}

export async function saveBoundsIfKose(win: chrome.windows.Window): Promise<void> {
  if (win.id === undefined || win.id !== (await getKoseWindowId())) return;
  if (win.width === undefined || win.height === undefined) return;
  const bounds: Bounds = { left: win.left, top: win.top, width: win.width, height: win.height };
  await chrome.storage.local.set({ [BOUNDS_KEY]: bounds });
}
