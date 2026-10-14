import { M } from '../shared/messages';
import type { FactClaim, Verdict } from './types';

/** 直す必要のある判定（反映した版を作るときに送る） */
export function needsFix(verdict: Verdict): boolean {
  return verdict === 'inaccurate' || verdict === 'misleading';
}

/** 事実確認の指摘を相談に送るときの依頼文（判定・理由・出典を添えて、事実を直した案を作ってもらう） */
export function factCheckApplyMessage(claims: FactClaim[]): string {
  const list = claims
    .filter((c) => needsFix(c.verdict))
    .map((c, n) => {
      const quote = c.quote ? `「${c.quote}」` : c.claim;
      const sources = c.sources.map((s) => `   ${s.url}`).join('\n');
      return `${n + 1}. ${quote} [${M.factCheck.verdicts[c.verdict]}] ${c.explanation}${sources ? `\n${sources}` : ''}`;
    })
    .join('\n');
  return M.factCheck.applyRequest(list);
}

export type MarkedSegment = { text: string; claim?: number };

/**
 * 原文を、主張の引用（quote）の箇所とそれ以外に分ける。
 * 引用は原文の最初の出現に当て、先に当てた箇所と重なるものは当てない。
 */
export function markClaims(sourceText: string, claims: FactClaim[]): MarkedSegment[] {
  const ranges: { start: number; end: number; claim: number }[] = [];
  claims.forEach((c, i) => {
    if (!c.quote) return;
    const start = sourceText.indexOf(c.quote);
    if (start < 0) return;
    const end = start + c.quote.length;
    if (ranges.some((r) => start < r.end && r.start < end)) return;
    ranges.push({ start, end, claim: i });
  });
  ranges.sort((a, b) => a.start - b.start);

  const segments: MarkedSegment[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) segments.push({ text: sourceText.slice(pos, r.start) });
    segments.push({ text: sourceText.slice(r.start, r.end), claim: r.claim });
    pos = r.end;
  }
  if (pos < sourceText.length) segments.push({ text: sourceText.slice(pos) });
  return segments;
}
