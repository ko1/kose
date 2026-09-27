export interface CapturedSelection {
  text: string;
  editable: boolean;
}

/**
 * 対象フレームに注入して選択文字列を改行付きで取得する。
 * executeScript で直列化されるため、この関数は外部の変数・importを参照してはならない。
 */
export function captureSelection(): CapturedSelection | null {
  const active = document.activeElement;
  if (
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && /^(text|search|url|email|tel)$/.test(active.type))
  ) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start !== null && end !== null && end > start) {
      return { text: active.value.slice(start, end), editable: true };
    }
  }
  const selection = window.getSelection();
  const text = selection?.toString() ?? '';
  if (!selection || text.trim() === '') return null;
  const node = selection.anchorNode;
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  return { text, editable: element instanceof HTMLElement && element.isContentEditable };
}
