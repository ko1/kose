export type DiffSegment = { type: 'equal' | 'insert' | 'delete'; text: string };

/** 英単語はまとめて、それ以外（日本語など）は1文字ずつトークン化する */
export function tokenize(text: string): string[] {
  return text.match(/[\p{Script=Latin}\p{N}_'’-]+|\s+|./gsu) ?? [];
}

/** LCS計算のセル数上限。これを超える場合はnull（差分表示なし） */
const MAX_CELLS = 4_000_000;

export function diffTexts(before: string, after: string): DiffSegment[] | null {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;

  // lcs[i][j] = a[i..], b[j..] の LCS 長
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  const push = (type: DiffSegment['type'], text: string) => {
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += text;
    else segments.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      push('delete', a[i++]);
    } else {
      push('insert', b[j++]);
    }
  }
  while (i < n) push('delete', a[i++]);
  while (j < m) push('insert', b[j++]);
  return segments;
}
