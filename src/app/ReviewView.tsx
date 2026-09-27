import { useEffect, useState } from 'react';
import { formatCost } from '../ai/pricing';
import { diffTexts } from '../domain/diff';
import { LANGUAGE_LABELS, SITUATION_LABELS } from '../domain/labels';
import { currentVersion } from '../domain/session';
import { countChars } from '../domain/text';
import { structureApplyMessage } from '../domain/structure';
import type {
  ChangeType,
  MistakeCard,
  PartialExplanation,
  Rating,
  ResultVersion,
  ReviewSession,
  StructureReview,
} from '../domain/types';
import { ChatSection } from './ChatSection';
import { QuizCard } from './QuizCard';
import type { ChatState, DownloadState, ExplainState } from './controller';

interface Props {
  session: ReviewSession;
  download: DownloadState | null;
  partialText: string | null;
  onRetry: () => void;
  onDownload: () => void;
  onSelectVersion: (versionId: string) => void;
  /** デバッグ用JSONの文字列を作る */
  debugJson: () => string;
  explainStates: Readonly<Record<string, ExplainState>>;
  /** 現在のプロバイダーがクラウドか */
  external: boolean;
  onExplain: (versionId: string) => void;
  chatState: ChatState | null;
  onSendChat: (text: string) => void;
  onRetryChat: () => void;
  /** この実行の待ち時間に出す復習クイズ */
  quizCard: MistakeCard | null;
  onRateCard: (cardId: string, rating: Rating) => void;
}

export function ReviewView({
  session,
  download,
  partialText,
  onRetry,
  onDownload,
  onSelectVersion,
  debugJson,
  explainStates,
  external,
  onExplain,
  chatState,
  onSendChat,
  onRetryChat,
  quizCard,
  onRateCard,
}: Props) {
  const version = currentVersion(session);
  // 生成中は途中の改稿文を、前の案の代わりに表示する
  const streaming = session.status.kind === 'running' && partialText !== null;
  // 改稿文が届き始めるまでが待ち時間
  const waiting = session.status.kind === 'running' && partialText === null && !version;
  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>ORIGINAL</h2>
          <span className="meta">{countChars(session.sourceText)}字</span>
        </div>
        <p className="text original">{session.sourceText}</p>
        {session.source.textSource === 'selectionText' && (
          <p className="note">このページでは選択範囲を直接読み取れなかったため、改行が失われている可能性があります。</p>
        )}
      </section>

      <StatusPanel session={session} download={download} onRetry={onRetry} onDownload={onDownload} />

      {quizCard && (
        <WaitingQuiz key={quizCard.id} card={quizCard} waiting={waiting} onRate={(r) => onRateCard(quizCard.id, r)} />
      )}

      {streaming && (
        <section className="section">
          <div className="section-head">
            <h2>RESULT</h2>
            <span className="meta">生成中…</span>
          </div>
          <div className="result-box">
            <p className="text result">
              {partialText}
              <span className="caret" aria-hidden />
            </p>
          </div>
          <p className="note">改稿文のあとに、解説と変更点を生成しています。</p>
        </section>
      )}

      {version && !streaming && (
        <>
          <ResultSection session={session} version={version} onSelectVersion={onSelectVersion} />
          <DiffSection session={session} version={version} />
          <ExplanationSection
            key={version.id}
            version={version}
            state={explainStates[version.id]}
            external={external}
            onExplain={() => onExplain(version.id)}
            onApplyStructure={
              session.status.kind === 'running' || chatState?.kind === 'running'
                ? undefined
                : (issues) => onSendChat(structureApplyMessage(issues))
            }
          />
          <ChatSection
            session={session}
            state={chatState}
            disabled={session.status.kind === 'running'}
            external={external}
            onSend={onSendChat}
            onRetry={onRetryChat}
            onSelectVersion={onSelectVersion}
          />
        </>
      )}

      <CopyButton className="link debug-copy" label="デバッグ用にJSONをコピー" getText={debugJson} />
    </>
  );
}

/** 待ち時間の復習クイズ。改稿文が届き始めたら1行にたたみ、結果を読めるようにする */
function WaitingQuiz({ card, waiting, onRate }: { card: MistakeCard; waiting: boolean; onRate: (r: Rating) => void }) {
  const [open, setOpen] = useState(waiting);
  useEffect(() => {
    if (!waiting) setOpen(false);
  }, [waiting]);
  return (
    <details className="section quiz-panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <h2>待ち時間に復習</h2>
        {!open && <span className="meta"> {card.before}</span>}
      </summary>
      <QuizCard card={card} onRate={onRate} />
    </details>
  );
}

function CopyButton({ label, getText, className }: { label: string; getText: () => string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(getText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button className={className} onClick={copy}>
      {copied ? 'Copied' : label}
    </button>
  );
}

function StatusPanel({
  session,
  download,
  onRetry,
  onDownload,
}: Pick<Props, 'session' | 'download' | 'onRetry' | 'onDownload'>) {
  const status = session.status;
  switch (status.kind) {
    case 'running':
      return (
        <div className="status" role="status">
          <span className="spinner" aria-hidden /> {LANGUAGE_LABELS[session.targetLanguage].target}
          （{SITUATION_LABELS[session.situation].name}）にしています… <Elapsed since={status.startedAt} />
        </div>
      );
    case 'error':
      return (
        <div className="status error" role="alert">
          <p>{status.message}</p>
          <button onClick={onRetry}>再実行</button>
        </div>
      );
    case 'interrupted':
      return (
        <div className="status warn">
          <p>処理が中断されました。</p>
          <button onClick={onRetry}>再実行</button>
        </div>
      );
    case 'too-long':
      return (
        <div className="status error" role="alert">
          <p>文章が長すぎるため実行しませんでした（上限: {status.limit.toLocaleString()}）。選択範囲を短くしてください。</p>
        </div>
      );
    case 'needs-download':
      return (
        <div className="status warn">
          <p>
            {status.inProgress
              ? 'Chromeが内蔵AIのモデルをダウンロード中です。'
              : 'Chrome内蔵AIのモデルがまだダウンロードされていません。初回のみダウンロードが必要です（数GBあるため時間がかかります）。'}
          </p>
          {download === null ? (
            <button onClick={onDownload}>{status.inProgress ? '進捗を表示して待つ' : 'モデルをダウンロード'}</button>
          ) : (
            <DownloadProgress download={download} />
          )}
          <p className="note">
            詳しい状況は <code>chrome://on-device-internals</code> の「Assets」欄（nano で始まる行）で確認できます。{' '}
            <button className="link" onClick={openOnDeviceInternals}>
              開く
            </button>
          </p>
        </div>
      );
    case 'idle':
      return null;
  }
}

function DownloadProgress({ download }: { download: DownloadState }) {
  const known = download.ratio > 0;
  return (
    <div className="download">
      {/* 進捗が届くまでは不確定表示（value なし）にする */}
      {known ? <progress value={download.ratio} max={1} /> : <progress />}
      <p className="note">
        {known ? `${Math.floor(download.ratio * 100)}%` : '進捗の通知を待っています'}・経過 <Elapsed since={download.startedAt} />
        <br />
        Chromeは進捗をまとめて通知することがあります。完了すると自動で処理を再開します。
      </p>
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const sec = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="meta">{sec < 60 ? `${sec}秒` : `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`}</span>;
}

function openOnDeviceInternals() {
  chrome.tabs.create({ url: 'chrome://on-device-internals' }).catch(() => {
    // 開けない場合はアドレスバーに入力してもらう（画面に表示済み）
  });
}

function ResultSection({
  session,
  version,
  onSelectVersion,
}: {
  session: ReviewSession;
  version: ResultVersion;
  onSelectVersion: (id: string) => void;
}) {
  const index = session.versions.indexOf(version);
  return (
    <section className="section">
      <div className="section-head">
        <h2>RESULT</h2>
        <span className="meta">
          {LANGUAGE_LABELS[version.targetLanguage].target}・{SITUATION_LABELS[version.situation].name}
          {version.durationMs !== undefined && `・${(version.durationMs / 1000).toFixed(1)}秒`}
          {formatCost(version.result.usage) && `・${formatCost(version.result.usage)}`}
        </span>
      </div>
      <div className="result-box">
        <p className="text result">{version.result.revisedText}</p>
        <CopyButton className="copy" label="Copy" getText={() => version.result.revisedText} />
      </div>
      {session.versions.length > 1 && (
        <div className="versions">
          <button disabled={index <= 0} onClick={() => onSelectVersion(session.versions[index - 1].id)}>
            ← 前の案
          </button>
          <span className="meta">
            案 {index + 1} / {session.versions.length}
            {version.origin === 'chat' && '（相談で作成）'}
            {version.origin === 'regenerate' && '（再生成）'}
          </span>
          <button
            disabled={index >= session.versions.length - 1}
            onClick={() => onSelectVersion(session.versions[index + 1].id)}
          >
            次の案 →
          </button>
        </div>
      )}
    </section>
  );
}

const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  objective_error: '誤り',
  style: '改善',
  uncertain: '要確認',
};

function DiffSection({ session, version }: { session: ReviewSession; version: ResultVersion }) {
  const { result } = version;
  const { sourceText, sourceLanguage } = session;
  const unchanged = result.revisedText === sourceText;
  const sameLanguage = sourceLanguage === version.targetLanguage;
  // 差分はブラウザ内で計算する（AIの費用はかからない）
  const diff = sameLanguage && !unchanged ? diffTexts(sourceText, result.revisedText) : null;
  return (
    <>
      {unchanged && <p className="unchanged">変更の必要はありません。</p>}
      {sourceLanguage === 'unknown' && <p className="note">原文の言語を判別できませんでした。</p>}
      {sourceLanguage === 'mixed' && <p className="note">原文は日本語と英語が混在していると判定しました。</p>}
      {diff && (
        <section className="section">
          <h2>差分</h2>
          <p className="text diff">
            {diff.map((seg, i) =>
              seg.type === 'equal' ? (
                <span key={i}>{seg.text}</span>
              ) : seg.type === 'insert' ? (
                <ins key={i}>{seg.text}</ins>
              ) : (
                <del key={i}>{seg.text}</del>
              ),
            )}
          </p>
        </section>
      )}
    </>
  );
}

function ExplanationSection({
  version,
  state,
  external,
  onExplain,
  onApplyStructure,
}: {
  version: ResultVersion;
  state: ExplainState | undefined;
  /** クラウドへ送信するプロバイダーか（ボタンに費用がかかることを示す） */
  external: boolean;
  onExplain: () => void;
  /** 構成の指摘を相談に送って、構成を直した案を作る。送れないときは undefined */
  onApplyStructure?: (issues: StructureReview['issues']) => void;
}) {
  const explanation = version.explanation;
  if (explanation) {
    return (
      <details className="section explanation" open>
        <summary>
          <h2>解説</h2>
          {explanation.durationMs !== undefined && (
            <span className="meta">
              {' '}
              {(explanation.durationMs / 1000).toFixed(1)}秒
              {formatCost(explanation.usage) && `・${formatCost(explanation.usage)}`}
            </span>
          )}
        </summary>
        <ExplanationBody explanation={explanation} onApplyStructure={onApplyStructure} />
        {explanation.droppedChanges > 0 && (
          <p className="note">原文・改稿文と照合できなかった変更点 {explanation.droppedChanges} 件は表示していません。</p>
        )}
      </details>
    );
  }

  return (
    <section className="section explanation">
      <h2>解説</h2>
      {state?.kind === 'running' ? (
        <>
          <p className="note" role="status">
            <span className="spinner" aria-hidden /> 解説を生成しています… <Elapsed since={state.startedAt} />
          </p>
          {state.partial && <ExplanationBody explanation={state.partial} />}
        </>
      ) : (
        <>
          {state?.kind === 'error' && (
            <p className="status error" role="alert">
              {state.message}
            </p>
          )}
          <button onClick={onExplain}>{state?.kind === 'error' ? '解説を再生成' : '解説を見る'}</button>
          {external && <p className="note">変更点と理由をAIに追加で問い合わせます（改稿より費用がかかります）。</p>}
        </>
      )}
    </section>
  );
}

/** 解説の本文。生成途中（一部の項目だけ）でも表示できる */
function ExplanationBody({
  explanation,
  onApplyStructure,
}: {
  explanation: PartialExplanation;
  onApplyStructure?: (issues: StructureReview['issues']) => void;
}) {
  const { explanationJa, changes = [], nuanceWarnings = [], structure } = explanation;
  const outline = structure?.outline ?? [];
  const issues = structure?.issues ?? [];
  return (
    <>
      {explanationJa && <p className="text">{explanationJa}</p>}

      {changes.length > 0 && (
        <>
          <h3>変更点</h3>
          <ul className="changes">
            {changes.map((c, i) => (
              <li key={i}>
                <span className={`badge badge-${c.type}`}>{CHANGE_TYPE_LABELS[c.type]}</span>
                <span className="change-pair">
                  {c.before ? <del>{c.before}</del> : <em>（追加）</em>} → {c.after ? <ins>{c.after}</ins> : <em>（削除）</em>}
                </span>
                <p className="change-explanation">{c.explanationJa}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {nuanceWarnings.length > 0 && (
        <>
          <h3>意味・ニュアンスの注意</h3>
          <ul className="warnings">
            {nuanceWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}

      {structure && (outline.length > 0 || issues.length > 0) && (
        <>
          <h3>構成</h3>
          {outline.length > 0 && (
            <ol className="outline">
              {outline.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ol>
          )}
          {issues.length > 0 ? (
            <ul className="structure-issues">
              {issues.map((it, i) => (
                <li key={i}>
                  <p>{it.problem}</p>
                  <p className="change-explanation">→ {it.suggestion}</p>
                </li>
              ))}
            </ul>
          ) : (
            outline.length > 0 && <p className="note">構成に大きな問題は見当たりません。</p>
          )}
          {issues.length > 0 && onApplyStructure && (
            <button onClick={() => onApplyStructure(issues)}>構成の指摘を反映した案を作る</button>
          )}
        </>
      )}
    </>
  );
}
