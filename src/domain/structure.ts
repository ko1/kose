import { countChars } from './text';

/** 構成を見る目安。短い文章では構成の指摘は不要で、費用だけが増える */
export const STRUCTURE_MIN_CHARS = 500;
export const STRUCTURE_MIN_PARAGRAPHS = 3;

export function countParagraphs(text: string): number {
  return text.split(/\n\s*\n|\n/).filter((p) => p.trim() !== '').length;
}

/** 長文（一定の長さ以上、または複数段落）なら解説で構成も見る */
export function needsStructureReview(text: string): boolean {
  return countChars(text) >= STRUCTURE_MIN_CHARS || countParagraphs(text) >= STRUCTURE_MIN_PARAGRAPHS;
}

/** 構成の指摘を相談に送るときの依頼文（指摘の内容を添えて、構成を直した案を作ってもらう） */
export function structureApplyMessage(issues: { problem: string; suggestion: string }[]): string {
  const list = issues.map((i, n) => `${n + 1}. ${i.problem} → ${i.suggestion}`).join('\n');
  return `次の構成の指摘を反映して、構成を直した案を作ってください。\n\n${list}`;
}
