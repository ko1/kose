import { useEffect, useRef } from 'react';
import { countChars } from '../domain/text';
import { M } from '../shared/messages';

/**
 * 自由入力（emacs の *scratch* のような欄）。ページで選択しなくても、ここに書いて kose にかけられる。
 * 下書きは実行しても消さない。
 */
export function ScratchView({
  draft,
  focusSeq,
  running,
  hasOtherSessions,
  onChange,
  onRun,
}: {
  draft: string;
  /** 増えたら入力欄にフォーカスする */
  focusSeq: number;
  running: boolean;
  /** ページから実行したレビューがあるか（なければ使い方を出す） */
  hasOtherSessions: boolean;
  onChange: (draft: string) => void;
  onRun: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [focusSeq]);

  const canRun = draft.trim() !== '' && !running;
  return (
    <section className="section scratch">
      <div className="section-head">
        <h2>{M.scratch.heading}</h2>
        <span className="meta">{M.scratch.chars(countChars(draft))}</span>
      </div>
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canRun) onRun();
          }
        }}
        placeholder={M.scratch.placeholder}
        aria-label={M.scratch.label}
        rows={6}
      />
      <div className="scratch-actions">
        <button className="primary" disabled={!canRun} onClick={onRun}>
          {M.scratch.run}
        </button>
      </div>
      {!hasOtherSessions && (
        <p className="note">{M.scratch.usage}</p>
      )}
    </section>
  );
}
