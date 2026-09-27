import { useEffect, useRef } from 'react';
import { countChars } from '../domain/text';

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
        <h2>自由入力</h2>
        <span className="meta">{countChars(draft)}字</span>
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
        placeholder="ここに文章を書いて、Ctrl+Enter で kose にかけます"
        aria-label="自由入力"
        rows={6}
      />
      <div className="scratch-actions">
        <span className="note">Ctrl+Enter で実行。下書きはブラウザを閉じるまで残ります。</span>
        <button className="primary" disabled={!canRun} onClick={onRun}>
          kose にかける
        </button>
      </div>
      {!hasOtherSessions && (
        <div className="empty">
          <p>Webページで文章を選択し、右クリック →「kose」、ツールバーの kose ボタン、または Alt+K でも実行できます。</p>
          <p>最後に選んだ機能（よい日本語にする／よい英語にする）で実行します。上の「機能」を切り替えて「変更」を押すと作り直せます。</p>
          <p>タブごとにレビューが保持され、ブラウザでタブを切り替えると表示も切り替わります。</p>
        </div>
      )}
    </section>
  );
}
