import type {
  ChatMessage,
  ChatRequest,
  Explanation,
  LanguageCode,
  PendingRequest,
  ResultVersion,
  ReviewSession,
  RewriteResult,
  Situation,
  SourceLocation,
  VersionOrigin,
} from './types';
import { newId } from '../shared/ids';
import { detectLanguage } from './language';

/** 自由入力のセッションを置く特別なタブID（実在のタブIDは 0 以上） */
export const SCRATCH_TAB_ID = -1;

export const SCRATCH_SOURCE: SourceLocation = {
  tabId: SCRATCH_TAB_ID,
  frameId: 0,
  tabTitle: '自由入力',
  textSource: 'script',
  editable: false,
};

export function createSession(req: PendingRequest, situation: Situation): ReviewSession {
  return {
    id: req.requestId,
    createdAt: req.createdAt,
    source: req.source,
    sourceText: req.text,
    sourceLanguage: detectLanguage(req.text),
    versions: [],
    currentVersionId: null,
    messages: [],
    targetLanguage: req.targetLanguage,
    situation,
    status: { kind: 'idle' },
  };
}

export function addVersion(
  session: ReviewSession,
  result: RewriteResult,
  settings: { targetLanguage: LanguageCode; situation: Situation },
  now: number = Date.now(),
  meta: { provider?: string; durationMs?: number; origin?: VersionOrigin } = {},
): ReviewSession {
  const { origin = session.versions.length === 0 ? 'initial' : 'regenerate', ...rest } = meta;
  const version: ResultVersion = {
    id: newId(),
    result,
    targetLanguage: settings.targetLanguage,
    situation: settings.situation,
    origin,
    createdAt: now,
    ...rest,
  };
  return {
    ...session,
    versions: [...session.versions, version],
    currentVersionId: version.id,
    status: { kind: 'idle' },
  };
}

export function setExplanation(session: ReviewSession, versionId: string, explanation: Explanation): ReviewSession {
  return {
    ...session,
    versions: session.versions.map((v) => (v.id === versionId ? { ...v, explanation } : v)),
  };
}

export function selectVersion(session: ReviewSession, versionId: string): ReviewSession {
  if (!session.versions.some((v) => v.id === versionId)) return session;
  return { ...session, currentVersionId: versionId };
}

export function currentVersion(session: ReviewSession): ResultVersion | undefined {
  return session.versions.find((v) => v.id === session.currentVersionId);
}

/**
 * アクティブタブが変わったときに表示すべきタブIDを決める。
 * セッションがあるタブならそれ、なければ現在の表示を維持する。
 */
export function displayedTabAfterActivation(
  sessions: ReadonlyMap<number, ReviewSession>,
  currentDisplayed: number,
  activatedTabId: number,
): number {
  return sessions.has(activatedTabId) ? activatedTabId : currentDisplayed;
}

/** 実行中だったセッションを「中断」にする（ウィンドウ再読み込み時の復元用） */
export function markInterrupted(session: ReviewSession): ReviewSession {
  // 言語判定を持たない古い形式のセッションも補って復元する
  const s = session.sourceLanguage ? session : { ...session, sourceLanguage: detectLanguage(session.sourceText) };
  return s.status.kind === 'running' ? { ...s, status: { kind: 'interrupted' } } : s;
}

export function appendMessage(session: ReviewSession, message: ChatMessage): ReviewSession {
  return { ...session, messages: [...session.messages, message] };
}

/** 相談の問い合わせを組み立てる。会話はこのセッションのものだけを使う（他のレビューと混ぜない） */
export function buildChatRequest(session: ReviewSession, message: string, requestId: string): ChatRequest | null {
  const current = currentVersion(session);
  if (!current) return null;
  const revisedOf = (versionId?: string) => session.versions.find((v) => v.id === versionId)?.result.revisedText;
  return {
    requestId,
    sourceText: session.sourceText,
    targetLanguage: current.targetLanguage,
    situation: current.situation,
    currentRevisedText: current.result.revisedText,
    previousRevisedTexts: session.versions.map((v) => v.result.revisedText),
    history: session.messages.map((m) =>
      m.role === 'assistant' ? { role: m.role, content: m.content, revisedText: revisedOf(m.versionId) } : m,
    ),
    message,
  };
}
