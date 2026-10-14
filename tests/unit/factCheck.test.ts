import { describe, expect, it } from 'vitest';
import { normalizeUrl, parseFactCheckOutput } from '../../src/ai/schema';
import { factCheckApplyMessage, markClaims } from '../../src/domain/factCheck';
import type { FactClaim } from '../../src/domain/types';

const source = '東京タワーは1950年に完成した。高さは333mである。';
const claim = (over: Partial<FactClaim>): FactClaim => ({
  quote: '',
  claim: 'c',
  verdict: 'accurate',
  explanation: 'e',
  sources: [],
  ...over,
});

describe('parseFactCheckOutput', () => {
  const searched = new Set([normalizeUrl('https://example.com/tower/')]);

  it('検索で見つかった出典だけを残し、根拠のない判定は「確認できず」にする', () => {
    const out = parseFactCheckOutput(
      {
        summary: 's',
        claims: [
          {
            quote: '1950年に完成',
            claim: '1950年完成',
            verdict: 'inaccurate',
            explanation: '1958年',
            sources: [
              { title: 'ok', url: 'https://example.com/tower#history' },
              { title: 'dup', url: 'https://example.com/tower' },
              { title: 'made up', url: 'https://example.com/fake' },
            ],
          },
          { quote: '原文にない', claim: '高さ', verdict: 'accurate', explanation: 'e', sources: [{ title: 'x', url: 'https://x.test/' }] },
        ],
      },
      source,
      searched,
    );
    expect(out.claims[0]).toMatchObject({ quote: '1950年に完成', verdict: 'inaccurate' });
    expect(out.claims[0].sources).toEqual([{ title: 'ok', url: 'https://example.com/tower#history' }]);
    expect(out.claims[1]).toMatchObject({ quote: '', verdict: 'unverified', sources: [] });
  });

  it('形が違えば例外', () => {
    expect(() => parseFactCheckOutput({ summary: 's', claims: [{ verdict: 'true' }] }, source, searched)).toThrow();
  });
});

describe('markClaims', () => {
  it('引用の箇所を主張の番号付きで切り出し、重なるものは後のほうを当てない', () => {
    const segs = markClaims(source, [
      claim({ quote: '333m' }),
      claim({ quote: '1950年に完成' }),
      claim({ quote: '1950年' }),
      claim({ quote: '' }),
    ]);
    expect(segs.map((s) => s.text).join('')).toBe(source);
    expect(segs.filter((s) => s.claim !== undefined)).toEqual([
      { text: '1950年に完成', claim: 1 },
      { text: '333m', claim: 0 },
    ]);
  });
});

describe('factCheckApplyMessage', () => {
  it('誤り・誤解を招くものだけを、理由と出典付きで並べる', () => {
    const msg = factCheckApplyMessage([
      claim({ quote: '1950年', verdict: 'inaccurate', explanation: '1958年に完成', sources: [{ title: 't', url: 'https://example.com/a' }] }),
      claim({ quote: '333m', verdict: 'accurate' }),
      claim({ claim: '世界一高い', verdict: 'misleading', explanation: '当時は自立式鉄塔で世界一' }),
    ]);
    expect(msg).toContain('1950年');
    expect(msg).toContain('1958年に完成');
    expect(msg).toContain('https://example.com/a');
    expect(msg).toContain('2. 世界一高い');
    expect(msg).not.toContain('333m');
  });
});
