import { describe, expect, it } from 'vitest';
import { countParagraphs, needsStructureReview, structureApplyMessage } from '../../src/domain/structure';

describe('structure', () => {
  it('長文（500字以上）または3段落以上なら構成を見る', () => {
    expect(needsStructureReview('短い文です。')).toBe(false);
    expect(needsStructureReview('a'.repeat(500))).toBe(true);
    expect(needsStructureReview('一段落目\n\n二段落目\n\n三段落目')).toBe(true);
    expect(needsStructureReview('一段落目\n\n二段落目')).toBe(false);
  });

  it('空行・改行で段落を数える', () => {
    expect(countParagraphs('a\n\nb\nc\n\n\n')).toBe(3);
  });

  it('構成の指摘を添えた依頼文を作る', () => {
    expect(structureApplyMessage([{ problem: '結論が最後', suggestion: '冒頭へ' }])).toBe(
      '次の構成の指摘を反映して、構成を直した案を作ってください。\n\n1. 結論が最後 → 冒頭へ',
    );
  });
});
