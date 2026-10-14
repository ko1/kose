import { useEffect, useRef, useState } from 'react';
import { countChars } from '../domain/text';
import { M } from '../shared/messages';
import { FactCheckButton, type FactCheckButtonState } from './SettingsBar';

/**
 * 自由入力（emacs の *scratch* のような欄）。ページで選択しなくても、ここに書いて kose にかけられる。
 * 下書きは実行しても消さない。補足（目的・読み手など）を添えると、改稿・解説・相談に指示として渡す。
 */
export function ScratchView({
  draft,
  note,
  focusSeq,
  running,
  hasOtherSessions,
  onChange,
  onNoteChange,
  onRun,
  factCheck,
  onFactCheck,
}: {
  draft: string;
  note: string;
  /** 増えたら入力欄にフォーカスする */
  focusSeq: number;
  running: boolean;
  /** ページから実行したレビューがあるか（なければ使い方を出す） */
  hasOtherSessions: boolean;
  onChange: (draft: string) => void;
  onNoteChange: (note: string) => void;
  onRun: () => void;
  factCheck: FactCheckButtonState;
  onFactCheck: () => void;
}) {
  // 補足が書いてあれば最初から開いておく（閉じたまま効いているのに気づかない、をなくす）
  const [noteOpen, setNoteOpen] = useState(note.trim() !== '');
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [focusSeq]);

  const canRun = draft.trim() !== '' && !running;
  const runOnCtrlEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canRun) onRun();
    }
  };
  const notePreview = note.trim().split('\n')[0];
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
        onKeyDown={runOnCtrlEnter}
        placeholder={M.scratch.placeholder}
        aria-label={M.scratch.label}
        rows={6}
      />
      {noteOpen && (
        <textarea
          ref={noteRef}
          className="scratch-note"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          onKeyDown={runOnCtrlEnter}
          placeholder={M.scratch.notePlaceholder}
          aria-label={M.scratch.noteLabel}
          rows={2}
        />
      )}
      <div className="scratch-actions">
        <button
          className="link note-toggle"
          aria-expanded={noteOpen}
          onClick={() => {
            setNoteOpen(!noteOpen);
            if (!noteOpen) setTimeout(() => noteRef.current?.focus());
          }}
          title={M.scratch.noteToggleTitle}
        >
          {noteOpen ? M.scratch.noteClose : notePreview ? M.scratch.noteWith(notePreview) : M.scratch.noteOpen}
        </button>
        <span className="actions">
          <FactCheckButton state={factCheck} disabled={draft.trim() === ''} onClick={onFactCheck} />
          <button className="primary" disabled={!canRun} onClick={onRun}>
            {M.scratch.run}
          </button>
        </span>
      </div>
      {!hasOtherSessions && (
        <p className="note">{M.scratch.usage}</p>
      )}
    </section>
  );
}
