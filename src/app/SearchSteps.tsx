import type { FactSource, SearchStep } from '../domain/types';
import { M } from '../shared/messages';
import { hostOf } from './SourceLink';

/** Web 検索の経過。検索語と、届いた結果の件数・サイト */
export function SearchSteps({ searches }: { searches: SearchStep[] }) {
  if (searches.length === 0) return null;
  return (
    <ul className="queries">
      {searches.map((s, i) => (
        <li key={i}>
          🔍 {s.query || '…'}{' '}
          <span className="meta">
            {s.results === undefined ? M.search.searching : M.search.found(s.results.length, hostsOf(s.results))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 結果のサイト名（www. を除く、重複なし、先頭3件まで） */
function hostsOf(results: FactSource[]): { shown: string[]; more: boolean } {
  const hosts = [...new Set(results.map((r) => hostOf(r.url).replace(/^www\./, '')))];
  return { shown: hosts.slice(0, 3), more: hosts.length > 3 };
}
