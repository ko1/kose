import { useEffect, useState } from 'react';
import { formatCost } from '../ai/pricing';
import { diffTexts } from '../domain/diff';
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
import { M } from '../shared/messages';
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
          <h2>{M.review.original}</h2>
          <span className="meta">{M.review.chars(countChars(session.sourceText))}</span>
        </div>
        <p className="text original">{session.sourceText}</p>
        {session.source.textSource === 'selectionText' && (
          <p className="note">{M.review.selectionTextNote}</p>
        )}
      </section>

      <StatusPanel session={session} download={download} onRetry={onRetry} onDownload={onDownload} />

      {quizCard && (
        <WaitingQuiz key={quizCard.id} card={quizCard} waiting={waiting} onRate={(r) => onRateCard(quizCard.id, r)} />
      )}

      {streaming && (
        <section className="section">
          <div className="section-head">
            <h2>{M.review.result}</h2>
            <span className="meta">{M.review.generating}</span>
          </div>
          <div className="result-box">
            <p className="text result">
              {partialText}
              <span className="caret" aria-hidden />
            </p>
          </div>
          <p className="note">{M.review.generatingNote}</p>
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

      <CopyButton className="link debug-copy" label={M.review.debugCopy} getText={debugJson} />
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
        <h2>{M.review.waitingQuiz}</h2>
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
      {copied ? M.review.copied : label}
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
          <span className="spinner" aria-hidden />{' '}
          {M.review.running(M.languages[session.targetLanguage].target, M.situations[session.situation])}{' '}
          <Elapsed since={status.startedAt} />
        </div>
      );
    case 'error':
      return (
        <div className="status error" role="alert">
          <p>{status.message}</p>
          <button onClick={onRetry}>{M.review.retry}</button>
        </div>
      );
    case 'interrupted':
      return (
        <div className="status warn">
          <p>{M.review.interrupted}</p>
          <button onClick={onRetry}>{M.review.retry}</button>
        </div>
      );
    case 'too-long':
      return (
        <div className="status error" role="alert">
          <p>{M.review.tooLong(status.limit.toLocaleString())}</p>
        </div>
      );
    case 'needs-download':
      return (
        <div className="status warn">
          <p>
            {status.inProgress ? M.review.downloadInProgress : M.review.downloadNeeded}
          </p>
          {download === null ? (
            <button onClick={onDownload}>{status.inProgress ? M.review.downloadWait : M.review.downloadStart}</button>
          ) : (
            <DownloadProgress download={download} />
          )}
          <p className="note">
            {M.review.downloadDetails[0]} <code>chrome://on-device-internals</code>
            {M.review.downloadDetails[1]}{' '}
            <button className="link" onClick={openOnDeviceInternals}>
              {M.review.open}
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
        {known ? M.review.downloadPercent(Math.floor(download.ratio * 100)) : M.review.downloadWaiting} · {M.review.downloadElapsed}{' '}
        <Elapsed since={download.startedAt} />
        <br />
        {M.review.downloadNote}
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
  return <span className="meta">{sec < 60 ? M.review.seconds(sec) : M.review.minutes(Math.floor(sec / 60), sec % 60)}</span>;
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
        <h2>{M.review.result}</h2>
        <span className="meta">
          {M.languages[version.targetLanguage].target} · {M.situations[version.situation]}
          {version.durationMs !== undefined && ` · ${M.review.durationSeconds(version.durationMs / 1000)}`}
          {formatCost(version.result.usage) && ` · ${formatCost(version.result.usage)}`}
        </span>
      </div>
      <div className="result-box">
        <p className="text result">{version.result.revisedText}</p>
        <CopyButton className="copy" label={M.review.copy} getText={() => version.result.revisedText} />
      </div>
      {session.versions.length > 1 && (
        <div className="versions">
          <button disabled={index <= 0} onClick={() => onSelectVersion(session.versions[index - 1].id)}>
            {M.review.previous}
          </button>
          <span className="meta">
            {M.review.versionOf(index + 1, session.versions.length)}
            {version.origin === 'chat' && M.review.fromChat}
            {version.origin === 'regenerate' && M.review.regenerated}
          </span>
          <button
            disabled={index >= session.versions.length - 1}
            onClick={() => onSelectVersion(session.versions[index + 1].id)}
          >
            {M.review.next}
          </button>
        </div>
      )}
    </section>
  );
}

const CHANGE_TYPE_LABELS: Record<ChangeType, string> = M.review.changeTypes;

function DiffSection({ session, version }: { session: ReviewSession; version: ResultVersion }) {
  const { result } = version;
  const { sourceText, sourceLanguage } = session;
  const unchanged = result.revisedText === sourceText;
  const sameLanguage = sourceLanguage === version.targetLanguage;
  // 差分はブラウザ内で計算する（AIの費用はかからない）
  const diff = sameLanguage && !unchanged ? diffTexts(sourceText, result.revisedText) : null;
  return (
    <>
      {unchanged && <p className="unchanged">{M.review.unchanged}</p>}
      {sourceLanguage === 'unknown' && <p className="note">{M.review.unknownLanguage}</p>}
      {sourceLanguage === 'mixed' && <p className="note">{M.review.mixedLanguage}</p>}
      {diff && (
        <section className="section">
          <h2>{M.review.diff}</h2>
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
          <h2>{M.review.explanation}</h2>
          {explanation.durationMs !== undefined && (
            <span className="meta">
              {' '}
              {M.review.durationSeconds(explanation.durationMs / 1000)}
              {formatCost(explanation.usage) && ` · ${formatCost(explanation.usage)}`}
            </span>
          )}
        </summary>
        <ExplanationBody explanation={explanation} onApplyStructure={onApplyStructure} />
        {explanation.droppedChanges > 0 && (
          <p className="note">{M.review.droppedChanges(explanation.droppedChanges)}</p>
        )}
      </details>
    );
  }

  return (
    <section className="section explanation">
      <h2>{M.review.explanation}</h2>
      {state?.kind === 'running' ? (
        <>
          <p className="note" role="status">
            <span className="spinner" aria-hidden /> {M.review.explaining} <Elapsed since={state.startedAt} />
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
          <button onClick={onExplain}>{state?.kind === 'error' ? M.review.regenerateExplanation : M.review.showExplanation}</button>
          {external && <p className="note">{M.review.explanationCostNote}</p>}
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
  const { explanation: overall, changes = [], nuanceWarnings = [], structure } = explanation;
  const outline = structure?.outline ?? [];
  const issues = structure?.issues ?? [];
  return (
    <>
      {overall && <p className="text">{overall}</p>}

      {changes.length > 0 && (
        <>
          <h3>{M.review.changes}</h3>
          <ul className="changes">
            {changes.map((c, i) => (
              <li key={i}>
                <span className={`badge badge-${c.type}`}>{CHANGE_TYPE_LABELS[c.type]}</span>
                <span className="change-pair">
                  {c.before ? <del>{c.before}</del> : <em>{M.review.added}</em>} →{' '}
                  {c.after ? <ins>{c.after}</ins> : <em>{M.review.removed}</em>}
                </span>
                <p className="change-explanation">{c.explanation}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {nuanceWarnings.length > 0 && (
        <>
          <h3>{M.review.nuance}</h3>
          <ul className="warnings">
            {nuanceWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}

      {structure && (outline.length > 0 || issues.length > 0) && (
        <>
          <h3>{M.review.structure}</h3>
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
            outline.length > 0 && <p className="note">{M.review.structureOk}</p>
          )}
          {issues.length > 0 && onApplyStructure && (
            <button onClick={() => onApplyStructure(issues)}>{M.review.applyStructure}</button>
          )}
        </>
      )}
    </>
  );
}
