import { describe, expect, it } from 'vitest';
import { buildChatSystemPrompt } from '../../src/ai/prompts';
import { normalizeUrl, parseChatOutput, parseChatWithSourcesOutput, parseFactCheckOutput } from '../../src/ai/schema';
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

describe('相談と事実確認', () => {
  const factCheck = {
    summary: '一部に誤り',
    claims: [claim({ quote: '1950年', claim: '1950年完成', verdict: 'inaccurate' as const, explanation: '1958年', sources: [{ title: 'T', url: 'https://example.com/t' }] })],
    queries: ['東京タワー 完成年'],
    createdAt: 0,
  };
  const chatRequest = {
    requestId: 'c',
    sourceText: source,
    targetLanguage: 'ja' as const,
    explanationLanguage: 'ja',
    situation: 'casual' as const,
    previousRevisedTexts: [],
    history: [],
    message: 'なぜ誤り？',
  };

  it('改稿がなく事実確認だけのときは、結果を前提に渡し、案を作らせず、検索の規則を加える', () => {
    const prompt = buildChatSystemPrompt({ ...chatRequest, factCheck, webSearch: true });
    expect(prompt).toContain('[inaccurate] "1950年"');
    expect(prompt).toContain('https://example.com/t');
    expect(prompt).toContain('There is no rewrite yet');
    expect(prompt).toContain('web_search');
    expect(prompt).not.toContain('CURRENT_REWRITE');
    const plain = buildChatSystemPrompt({ ...chatRequest, currentRevisedText: 'x', previousRevisedTexts: ['x'] });
    expect(plain).toContain('CURRENT_REWRITE');
    expect(plain).not.toContain('FACT_CHECK');
    expect(plain).not.toContain('web_search');
  });

  it('改稿がなければ返答の案は捨て、出典は見つかった URL だけを残す', () => {
    expect(parseChatOutput(JSON.stringify({ reply: 'r', revisedText: 'new' }), undefined).revisedText).toBeUndefined();
    const r = parseChatWithSourcesOutput(
      { reply: 'r', revisedText: 'new', sources: [{ title: 'ok', url: 'https://example.com/t/' }, { title: 'ng', url: 'https://made.up/' }] },
      'old',
      new Set([normalizeUrl('https://example.com/t')]),
    );
    expect(r).toMatchObject({ reply: 'r', revisedText: 'new', sources: [{ title: 'ok' }] });
    expect(r.sources).toHaveLength(1);
  });
});
