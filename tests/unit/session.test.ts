import { describe, expect, it } from 'vitest';
import {
  addVersion,
  createSession,
  currentVersion,
  displayedTabAfterActivation,
  SCRATCH_TAB_ID,
  markInterrupted,
  selectVersion,
  setExplanation,
} from '../../src/domain/session';
import type { PendingRequest, ReviewSession, RewriteResult } from '../../src/domain/types';

const req = (tabId: number): PendingRequest => ({
  requestId: `req-${tabId}`,
  targetLanguage: 'en',
  text: 'こんにちは',
  source: { tabId, frameId: 0, textSource: 'script', editable: false },
  createdAt: 1,
});

const result = (text: string): RewriteResult => ({ revisedText: text, detectedSourceLanguage: 'ja' });

describe('session', () => {
  it('最初の結果は initial、以降は regenerate として追加され、current が更新される', () => {
    let s = createSession(req(1), 'casual');
    expect(s.id).toBe('req-1');
    s = addVersion(s, result('Hello'), { targetLanguage: 'en', situation: 'casual' });
    s = addVersion(s, result('Good afternoon'), { targetLanguage: 'en', situation: 'formal' });
    expect(s.versions.map((v) => v.origin)).toEqual(['initial', 'regenerate']);
    expect(s.versions[1].situation).toBe('formal');
    expect(currentVersion(s)?.result.revisedText).toBe('Good afternoon');
  });

  it('解説は指定したバージョンにだけ付く', () => {
    let s = createSession(req(1), 'casual');
    s = addVersion(s, result('A'), { targetLanguage: 'en', situation: 'casual' });
    s = addVersion(s, result('B'), { targetLanguage: 'en', situation: 'casual' });
    const explanation = { explanationJa: 'x', changes: [], nuanceWarnings: [], droppedChanges: 0 };
    s = setExplanation(s, s.versions[0].id, explanation);
    expect(s.versions.map((v) => v.explanation)).toEqual([explanation, undefined]);
  });

  it('過去の案に戻せる。存在しないIDは無視', () => {
    let s = createSession(req(1), 'casual');
    s = addVersion(s, result('A'), { targetLanguage: 'en', situation: 'casual' });
    s = addVersion(s, result('B'), { targetLanguage: 'en', situation: 'casual' });
    s = selectVersion(s, s.versions[0].id);
    expect(currentVersion(s)?.result.revisedText).toBe('A');
    expect(selectVersion(s, 'nope')).toBe(s);
    expect(s.versions).toHaveLength(2);
  });

  it('アクティブタブにセッションがあれば切り替え、なければ表示を維持', () => {
    const sessions = new Map<number, ReviewSession>([
      [1, createSession(req(1), 'casual')],
      [2, createSession(req(2), 'casual')],
    ]);
    expect(displayedTabAfterActivation(sessions, 2, 1)).toBe(1);
    expect(displayedTabAfterActivation(sessions, 1, 3)).toBe(1);
    expect(displayedTabAfterActivation(sessions, SCRATCH_TAB_ID, 3)).toBe(SCRATCH_TAB_ID);
  });

  it('実行中のセッションだけを中断扱いにする', () => {
    const s = createSession(req(1), 'casual');
    expect(markInterrupted({ ...s, status: { kind: 'running', requestId: 'x', startedAt: 0 } }).status.kind).toBe('interrupted');
    expect(markInterrupted(s)).toBe(s);
  });
});
