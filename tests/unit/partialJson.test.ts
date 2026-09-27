import { describe, expect, it } from 'vitest';
import { appendChunk, extractPartialStringField, parsePartialJson } from '../../src/ai/partialJson';

describe('extractPartialStringField', () => {
  it('フィールドがまだ無ければ null', () => {
    expect(extractPartialStringField('{"revi', 'revisedText')).toBeNull();
  });

  it('途中まで生成された値を返す', () => {
    expect(extractPartialStringField('{"revisedText": "Hello, wor', 'revisedText')).toBe('Hello, wor');
  });

  it('閉じた値は閉じ引用符までを返す', () => {
    expect(extractPartialStringField('{"revisedText":"Hi.","explanationJa":"x"}', 'revisedText')).toBe('Hi.');
  });

  it('エスケープをデコードし、途中で切れたエスケープは含めない', () => {
    expect(extractPartialStringField('{"revisedText":"a\\nb \\"q\\" \\u3042', 'revisedText')).toBe('a\nb "q" あ');
    expect(extractPartialStringField('{"revisedText":"a\\', 'revisedText')).toBe('a');
    expect(extractPartialStringField('{"revisedText":"a\\u30', 'revisedText')).toBe('a');
  });
});

describe('appendChunk', () => {
  it('差分のチャンクは連結する', () => {
    expect(['{"a', '":"', 'x"}'].reduce(appendChunk, '')).toBe('{"a":"x"}');
  });

  it('累積のチャンクは置き換える', () => {
    expect(['{"a', '{"a":"', '{"a":"x"}'].reduce(appendChunk, '')).toBe('{"a":"x"}');
  });
});

describe('parsePartialJson', () => {
  it('閉じていない文字列・配列・オブジェクトを補う', () => {
    expect(parsePartialJson('{"explanationJa":"途中まで')).toEqual({ explanationJa: '途中まで' });
    expect(parsePartialJson('{"a":"x","changes":[{"before":"a","after":"b"},{"before":"c"')).toEqual({
      a: 'x',
      changes: [{ before: 'a', after: 'b' }, { before: 'c' }],
    });
  });

  it('値のないキーなど解釈できない末尾は直前の区切りまで戻す', () => {
    expect(parsePartialJson('{"a":"x","b')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"a":"x","b":')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"a":"x\\')).toEqual({ a: 'x' });
  });

  it('完全なJSONはそのまま、空や解釈不能は null', () => {
    expect(parsePartialJson('{"a":[1,2]}')).toEqual({ a: [1, 2] });
    expect(parsePartialJson('')).toBeNull();
    expect(parsePartialJson('hello')).toBeNull();
  });
});
