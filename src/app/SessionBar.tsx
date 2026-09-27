import { SCRATCH_TAB_ID } from '../domain/session';
import type { ReviewSession } from '../domain/types';
import { M } from '../shared/messages';

export function SessionBar({
  sessions,
  displayedTabId,
  onSelect,
}: {
  sessions: ReviewSession[];
  displayedTabId: number;
  onSelect: (tabId: number) => void;
}) {
  // 自由入力は常に選べる項目として先頭に出す（そのセッションは一覧に重ねない）
  const pageSessions = sessions.filter((s) => s.source.tabId !== SCRATCH_TAB_ID);
  return (
    <label className="session-bar">
      <span className="visually-hidden">{M.window.sessionListLabel}</span>
      <select value={displayedTabId} onChange={(e) => onSelect(Number(e.target.value))} title={M.window.sessionListTitle}>
        <option value={SCRATCH_TAB_ID}>{M.window.scratchItem}</option>
        {pageSessions.map((s) => (
          <option key={s.id} value={s.source.tabId}>
            {sessionLabel(s)}
          </option>
        ))}
      </select>
    </label>
  );
}

function sessionLabel(s: ReviewSession): string {
  const title = s.source.tabTitle?.trim() || M.window.tabFallback(s.source.tabId);
  const snippet = s.sourceText.replace(/\s+/g, ' ').slice(0, 20);
  return `📄 ${title} — “${snippet}${s.sourceText.length > 20 ? '…' : ''}”`;
}
