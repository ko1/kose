export const LANGUAGE_CODES = ['ja', 'en'] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export const SITUATIONS = [
  'casual',
  'business',
  'technical',
  'academic',
  'presentation',
  'formal',
] as const;
export type Situation = (typeof SITUATIONS)[number];

export type ChangeType = 'objective_error' | 'style' | 'uncertain';
export type DetectedLanguage = LanguageCode | 'mixed' | 'unknown';

export interface RewriteRequest {
  requestId: string;
  sourceText: string;
  targetLanguage: LanguageCode;
  situation: Situation;
}

export interface Change {
  before: string;
  after: string;
  type: ChangeType;
  explanationJa: string;
  /** モデル申告。自動保存の十分条件ではない */
  confidence?: number;
}

/** API の利用量（クラウドのみ）。料金は分かる場合だけ */
export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

/** 1段目（右クリック時）の結果。改稿文だけ */
export interface RewriteResult {
  revisedText: string;
  detectedSourceLanguage: DetectedLanguage;
  usage?: Usage;
}

/** 2段目（解説）の結果 */
export interface Explanation {
  explanationJa: string;
  changes: Change[];
  nuanceWarnings: string[];
  /** 原文・改稿文と照合できず表示から除外した変更点の数 */
  droppedChanges: number;
  /** 生成したプロバイダーと所要時間。デバッグ・速度確認用 */
  provider?: string;
  durationMs?: number;
  usage?: Usage;
}

/** 生成途中の解説（表示用） */
export type PartialExplanation = Partial<Pick<Explanation, 'explanationJa' | 'changes' | 'nuanceWarnings'>>;

export interface ExplainRequest {
  requestId: string;
  sourceText: string;
  revisedText: string;
  targetLanguage: LanguageCode;
  situation: Situation;
}

export type VersionOrigin = 'initial' | 'regenerate' | 'chat';

export interface ResultVersion {
  id: string;
  result: RewriteResult;
  targetLanguage: LanguageCode;
  situation: Situation;
  origin: VersionOrigin;
  createdAt: number;
  /** 解説。まだ生成していなければ undefined */
  explanation?: Explanation;
  /** 生成したプロバイダー（'builtin' | 'openai' | 'anthropic'）と所要時間。デバッグ・速度確認用 */
  provider?: string;
  durationMs?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** assistant が新しい改稿案を作った場合、その案のバージョンID */
  versionId?: string;
  /** assistant の返答にかかった利用量（クラウドのみ） */
  usage?: Usage;
}

/** ニュアンス相談（Phase 2）の問い合わせ */
export interface ChatRequest {
  requestId: string;
  sourceText: string;
  targetLanguage: LanguageCode;
  situation: Situation;
  /** 表示中の改稿案 */
  currentRevisedText: string;
  /** これまでの改稿案（古い順、表示中のものを含む） */
  previousRevisedTexts: string[];
  /** これまでの会話（今回のユーザー発言は含まない）。assistant は返答と、そのとき作った改稿案 */
  history: { role: 'user' | 'assistant'; content: string; revisedText?: string }[];
  message: string;
}

export interface ChatReply {
  replyJa: string;
  /** 新しい改稿案。解説だけの返答なら undefined */
  revisedText?: string;
  usage?: Usage;
}

/** 選択元の記録。表示と将来のApplyの照合に使う。永続化しない */
export interface SourceLocation {
  tabId: number;
  frameId: number;
  /** ページ遷移の検出用 */
  documentId?: string;
  /** ヘッダー表示用 */
  tabTitle?: string;
  /** script: 改行を保持して取得 / selectionText: contextMenusの値（改行が失われる） */
  textSource: 'script' | 'selectionText';
  /** textarea/input/contenteditable 内の選択か */
  editable: boolean;
}

/** service worker から koseウィンドウへ渡す右クリック要求 */
export interface PendingRequest {
  requestId: string;
  targetLanguage: LanguageCode;
  text: string;
  source: SourceLocation;
  createdAt: number;
}

export type SessionStatus =
  | { kind: 'running'; requestId: string; startedAt: number }
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'interrupted' }
  /** Chrome内蔵モデルが未ダウンロード（inProgress: Chromeが既にダウンロード中） */
  | { kind: 'needs-download'; inProgress: boolean }
  | { kind: 'too-long'; limit: number };

export interface ReviewSession {
  /** 右クリック要求の requestId と同じ */
  id: string;
  createdAt: number;
  source: SourceLocation;
  sourceText: string;
  /** 原文の言語。文字の種類からブラウザ内で判定する（AIの申告は result 側に残す） */
  sourceLanguage: DetectedLanguage;
  versions: ResultVersion[];
  currentVersionId: string | null;
  messages: ChatMessage[];
  /** 最後に要求した設定（再生成・再実行で使う） */
  targetLanguage: LanguageCode;
  situation: Situation;
  status: SessionStatus;
}
