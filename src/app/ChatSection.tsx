import { KeyboardEvent, useState } from 'react';
import { formatCost } from '../ai/pricing';
import type { ReviewSession } from '../domain/types';
import type { ChatState } from './controller';

interface Props {
  session: ReviewSession;
  state: ChatState | null;
  /** 改稿の実行中など、相談を送れないとき */
  disabled: boolean;
  /** クラウドへ送信するプロバイダーか */
  external: boolean;
  onSend: (text: string) => void;
  onRetry: () => void;
  onSelectVersion: (versionId: string) => void;
}

/** ニュアンス相談。会話はこのレビュー（セッション）だけのもの */
export function ChatSection({ session, state, disabled, external, onSend, onRetry, onSelectVersion }: Props) {
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
      <h2>ニュアンスを相談</h2>
      {session.messages.length === 0 && !running && (
        <p className="note">
          例:「もっと苦労して帰宅したニュアンスにしたい」「〜と〜の違いは？」。書き換えを頼むと新しい案が作られます。
        </p>
      )}
      <ul className="messages">
        {session.messages.map((m, i) => (
          <li key={i} className={`message ${m.role}`}>
            <p className="text">{m.content}</p>
            {m.role === 'assistant' && (m.versionId || formatCost(m.usage)) && (
              <p className="message-meta">
                {m.versionId && (
                  <button
                    className="link"
                    onClick={() => onSelectVersion(m.versionId!)}
                    disabled={session.currentVersionId === m.versionId}
                  >
                    {session.currentVersionId === m.versionId
                      ? `案 ${versionNumber(m.versionId)} を表示中`
                      : `案 ${versionNumber(m.versionId)} を表示`}
                  </button>
                )}
                {formatCost(m.usage) && <span className="meta">{formatCost(m.usage)}</span>}
              </p>
            )}
          </li>
        ))}
        {running && (
          <li className="message assistant pending" role="status">
            {state.partial ? (
              <p className="text">
                {state.partial}
                <span className="caret" aria-hidden />
              </p>
            ) : (
              <p className="note">
                <span className="spinner" aria-hidden /> 考えています…
              </p>
            )}
          </li>
        )}
      </ul>
      {state?.kind === 'error' && (
        <div className="status error" role="alert">
          <p>{state.message}</p>
          <button onClick={onRetry}>送り直す</button>
        </div>
      )}
      <div className="chat-input">
        <textarea
          value={draft}
          rows={2}
          placeholder={disabled ? '改稿が終わると相談できます' : '相談したいこと（Enterで送信、Shift+Enterで改行）'}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="primary" onClick={send} disabled={!canSend}>
          送信
        </button>
      </div>
      {external && <p className="note">相談の内容と原文・改稿案がAIに送信されます。</p>}
    </section>
  );
}
