/** 表示用の文字数（サロゲートペアを1文字と数える） */
export function countChars(text: string): number {
  return [...text].length;
}
