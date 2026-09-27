import { describe, expect, it } from 'vitest';
import {
  explainJsonSchema,
  chatJsonSchema,
  InvalidModelOutputError,
  parseChatOutput,
  parseExplainOutput,
  parseRewriteOutput,
  rewriteJsonSchema,
} from '../../src/ai/schema';

const source = 'We finally had went back to home.';
const revised = 'We finally went back home.';

describe('parseRewriteOutput（1段目）', () => {
  const valid = { revisedText: revised, detectedSourceLanguage: 'en' };

  it('正しいJSONを受け付ける', () => {
    expect(parseRewriteOutput(JSON.stringify(valid))).toEqual(valid);
  });

  it('コードフェンスで囲まれていても受け付ける', () => {
    expect(parseRewriteOutput('```json\n' + JSON.stringify(valid) + '\n```').revisedText).toBe(revised);
  });

  it('JSONでない・スキーマ違反・改稿文が空ならエラー', () => {
    expect(() => parseRewriteOutput('Sure! Here is the text.')).toThrow(InvalidModelOutputError);
    expect(() => parseRewriteOutput(JSON.stringify({ ...valid, detectedSourceLanguage: 'fr' }))).toThrow(
      InvalidModelOutputError,
    );
    expect(() => parseRewriteOutput(JSON.stringify({ revisedText: revised }))).toThrow(InvalidModelOutputError);
    expect(() => parseRewriteOutput(JSON.stringify({ ...valid, revisedText: '  ' }))).toThrow(InvalidModelOutputError);
  });
});

describe('parseExplainOutput（2段目）', () => {
  const valid = {
    explanationJa: '時制と前置詞を修正しました。',
    changes: [
      { before: 'had went', after: 'went', type: 'objective_error', explanationJa: '過去完了の形が誤り' },
      { before: 'back to home', after: 'back home', type: 'objective_error', explanationJa: 'home は副詞' },
    ],
    nuanceWarnings: [],
  };

  it('正しいJSONを受け付ける', () => {
    const e = parseExplainOutput(JSON.stringify(valid), source, revised);
    expect(e.changes).toHaveLength(2);
    expect(e.droppedChanges).toBe(0);
  });

  it('原文・改稿文に実在しない before/after の変更点は除外する', () => {
    const out = {
      ...valid,
      changes: [
        ...valid.changes,
        { before: 'has gone', after: 'went', type: 'objective_error', explanationJa: '原文にない' },
        { before: 'had went', after: 'had gone', type: 'objective_error', explanationJa: '改稿文にない' },
      ],
    };
    const e = parseExplainOutput(JSON.stringify(out), source, revised);
    expect(e.changes.map((c) => c.before)).toEqual(['had went', 'back to home']);
    expect(e.droppedChanges).toBe(2);
  });

  it('スキーマに合わなければエラー', () => {
    const { changes: _c, ...missing } = valid;
    expect(() => parseExplainOutput(JSON.stringify(missing), source, revised)).toThrow(InvalidModelOutputError);
  });
});

describe('parseChatOutput（相談）', () => {
  it('改稿案が空、または表示中の案と同じなら改稿なし', () => {
    expect(parseChatOutput(JSON.stringify({ replyJa: '説明', revisedText: '' }), 'A.')).toEqual({ replyJa: '説明' });
    expect(parseChatOutput(JSON.stringify({ replyJa: '説明', revisedText: ' A. ' }), 'A.')).toEqual({ replyJa: '説明' });
    expect(parseChatOutput(JSON.stringify({ replyJa: '直しました', revisedText: 'B.' }), 'A.')).toEqual({
      replyJa: '直しました',
      revisedText: 'B.',
    });
  });

  it('返答が空ならエラー', () => {
    expect(() => parseChatOutput(JSON.stringify({ replyJa: ' ', revisedText: 'B.' }), 'A.')).toThrow(
      InvalidModelOutputError,
    );
  });
});

describe('JSON Schema', () => {
  it.each([
    ['rewrite', rewriteJsonSchema],
    ['explain', explainJsonSchema],
    ['chat', chatJsonSchema],
  ])('%s は OpenAI strict モードの要件（全項目 required、追加プロパティ禁止）を満たす', (_name, build) => {
    const schema = build() as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
      $schema?: string;
    };
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect(new Set(schema.required)).toEqual(new Set(Object.keys(schema.properties)));
  });
});
