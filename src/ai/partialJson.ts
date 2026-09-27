import type { Change, PartialExplanation } from '../domain/types';

/**
 * 生成途中のJSON文字列から、指定したトップレベルの文字列フィールドの（途中までの）値を取り出す。
 * フィールドがまだ現れていなければ null。値が途中で切れていれば、そこまでをデコードして返す。
 */
export function extractPartialStringField(json: string, field: string): string | null {
  const m = new RegExp(`"${field}"\\s*:\\s*"`).exec(json);
  if (!m) return null;
  let out = '';
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const ch = json[i];
    if (ch === '"') return out;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = json[i + 1];
    if (next === undefined) return out; // エスケープの途中で切れている
    if (next === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ESCAPES[next] ?? next;
    i++;
  }
  return out;
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };

/**
 * ストリームのチャンクを連結する。Prompt API の promptStreaming は、Chromeのバージョンにより
 * 差分（新しい部分だけ）と累積（先頭からの全文）のどちらかを返すため、両方に対応する。
 */
export function appendChunk(accumulated: string, chunk: string): string {
  return accumulated !== '' && chunk.startsWith(accumulated) ? chunk : accumulated + chunk;
}

/**
 * 生成途中のJSONを、閉じていない文字列・配列・オブジェクトを補って解釈する。
 * 最後の要素が途中で切れていて解釈できない場合は、直前の区切りまで戻して再試行する。
 * 解釈できなければ null。
 */
export function parsePartialJson(raw: string): unknown {
  let text = raw;
  for (let attempt = 0; attempt < 20 && text.trim() !== ''; attempt++) {
    try {
      return JSON.parse(closeJson(text));
    } catch {
      const cut = text.lastIndexOf(',');
      if (cut < 0) return null;
      text = text.slice(0, cut);
    }
  }
  return null;
}

function closeJson(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = text;
  if (inString) {
    if (escaped) out = out.slice(0, -1); // 途中で切れたエスケープを捨てる
    out += '"';
  }
  out = out.replace(/[\s,:]+$/, '');
  return out + stack.reverse().join('');
}

const strings = (xs: unknown[]): string[] => xs.filter((x): x is string => typeof x === 'string');

const CHANGE_TYPES = new Set(['objective_error', 'style', 'uncertain']);

/** 生成途中の解説JSONから、表示できる部分だけを取り出す */
export function extractPartialExplanation(raw: string): PartialExplanation | null {
  const json = parsePartialJson(raw);
  if (typeof json !== 'object' || json === null) return null;
  const obj = json as Record<string, unknown>;
  const out: PartialExplanation = {};
  if (typeof obj.explanationJa === 'string') out.explanationJa = obj.explanationJa;
  if (Array.isArray(obj.changes)) {
    out.changes = obj.changes.filter(
      (c): c is Change =>
        typeof c === 'object' &&
        c !== null &&
        typeof c.before === 'string' &&
        typeof c.after === 'string' &&
        CHANGE_TYPES.has(c.type) &&
        typeof c.explanationJa === 'string',
    );
  }
  if (Array.isArray(obj.nuanceWarnings)) {
    out.nuanceWarnings = strings(obj.nuanceWarnings);
  }
  if (typeof obj.structure === 'object' && obj.structure !== null) {
    const st = obj.structure as Record<string, unknown>;
    out.structure = {
      outline: Array.isArray(st.outline) ? strings(st.outline) : [],
      issues: Array.isArray(st.issues)
        ? st.issues.filter(
            (i): i is { problem: string; suggestion: string } =>
              typeof i === 'object' && i !== null && typeof i.problem === 'string' && typeof i.suggestion === 'string',
          )
        : [],
    };
  }
  return out;
}

/** 同じ値が続けて届いたときは通知しない */
export function distinct<T>(notify: (value: T) => void, key: (value: T) => string = JSON.stringify): (value: T) => void {
  let last: string | undefined;
  return (value) => {
    const k = key(value);
    if (k === last) return;
    last = k;
    notify(value);
  };
}
