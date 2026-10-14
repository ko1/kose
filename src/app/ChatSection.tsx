import { KeyboardEvent, useState } from 'react';
import { formatCost } from '../ai/pricing';
import type { ReviewSession } from '../domain/types';
import { M } from '../shared/messages';
import type { ChatState } from './controller';
import { SourceLink } from './SourceLink';

interface Props {
  session: ReviewSession;
  state: ChatState | null;
  /** 改稿の実行中など、相談を送れないとき */
  disabled: boolean;
  /** クラウドへ送信するプロバイダーか */
  external: boolean;
  /** 事実関係を Web 検索で調べることがあるか（事実確認の結果があり、検索できるプロバイダー） */
  webSearch: boolean;
  onSend: (text: string) => void;
  onRetry: () => void;
  onSelectVersion: (versionId: string) => void;
}

/** 相談（ニュアンス・事実確認の深掘り）。会話はこのレビュー（セッション）だけのもの */
export function ChatSection({ session, state, disabled, external, webSearch, onSend, onRetry, onSelectVersion }: Props) {
  const [draft, setDraft] = useState('');
  const running = state?.kind === 'running';
  const canSend = !disabled && !running && draft.trim() !== '';

  const send = () => {
    if (!canSend) return;
    onSend(draft);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 日本語入力の変換確定の Enter では送らない。Shift+Enter は改行
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const versionNumber = (versionId: string) => session.versions.findIndex((v) => v.id === versionId) + 1;

  return (
    <section className="section chat">
      <h2>{M.chat.heading}</h2>
      {session.messages.length === 0 && !running && (
        <p className="note">{session.factCheck ? M.chat.examplesWithFacts : M.chat.examples}</p>
      )}
      <ul className="messages">
        {session.messages.map((m, i) => (
          <li key={i} className={`message ${m.role}`}>
            <p className="text">{m.content}</p>
            {m.sources && m.sources.length > 0 && (
              <ul className="sources">
                {m.sources.map((s, j) => (
                  <li key={j}>
                    <SourceLink title={s.title} url={s.url} />
                  </li>
                ))}
              </ul>
            )}
            {m.role === 'assistant' && (m.versionId || formatCost(m.usage)) && (
              <p className="message-meta">
                {m.versionId &&
                  (session.currentVersionId === m.versionId ? (
                    <span className="version-updated">{M.chat.updated(versionNumber(m.versionId))}</span>
                  ) : (
                    <button className="link" onClick={() => onSelectVersion(m.versionId!)}>
                      {M.chat.showVersion(versionNumber(m.versionId))}
                    </button>
                  ))}
                {formatCost(m.usage) && <span className="meta">{formatCost(m.usage)}</span>}
              </p>
            )}
          </li>
        ))}
        {running && (
          <li className="message assistant pending" role="status">
            {state.queries && state.queries.length > 0 && (
              <ul className="queries">
                {state.queries.map((q, i) => (
                  <li key={i}>🔍 {q}</li>
                ))}
              </ul>
            )}
            {state.partial ? (
              <p className="text">
                {state.partial}
                <span className="caret" aria-hidden />
              </p>
            ) : (
              <p className="note">
                <span className="spinner" aria-hidden /> {M.chat.thinking}
              </p>
            )}
          </li>
        )}
      </ul>
      {state?.kind === 'error' && (
        <div className="status error" role="alert">
          <p>{state.message}</p>
          <button onClick={onRetry}>{M.chat.resend}</button>
        </div>
      )}
      <div className="chat-input">
        <textarea
          value={draft}
          rows={2}
          placeholder={disabled ? M.chat.placeholderDisabled : M.chat.placeholder}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="primary" onClick={send} disabled={!canSend}>
          {M.chat.send}
        </button>
      </div>
      {external && <p className="note">{M.chat.externalNote}</p>}
      {webSearch && <p className="note">{M.chat.searchNote}</p>}
    </section>
  );
}
