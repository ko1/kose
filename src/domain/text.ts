/** 表示用の文字数（サロゲートペアを1文字と数える） */
export function countChars(text: string): number {
  return [...text].length;
}

/** 選択範囲・自由入力の先頭の空行と末尾の空白・改行を除く（1行目のインデントは残す） */
export function trimSelection(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
}
