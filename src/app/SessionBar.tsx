import type { ReviewSession } from '../domain/types';

export function SessionBar({
  sessions,
  displayed,
  onSelect,
}: {
  sessions: ReviewSession[];
  displayed: ReviewSession | null;
  onSelect: (tabId: number) => void;
}) {
  return (
    <label className="session-bar">
      <span className="visually-hidden">表示するレビュー</span>
      <select
        value={displayed?.source.tabId ?? ''}
        onChange={(e) => onSelect(Number(e.target.value))}
        title="レビューの元タブ"
      >
        {!displayed && <option value="">レビューを選択</option>}
        {sessions.map((s) => (
          <option key={s.id} value={s.source.tabId}>
            {sessionLabel(s)}
          </option>
        ))}
      </select>
    </label>
  );
}

function sessionLabel(s: ReviewSession): string {
  const title = s.source.tabTitle?.trim() || `タブ ${s.source.tabId}`;
  const snippet = s.sourceText.replace(/\s+/g, ' ').slice(0, 20);
  return `📄 ${title} —「${snippet}${s.sourceText.length > 20 ? '…' : ''}」`;
}
