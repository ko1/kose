import { useSyncExternalStore } from 'react';
import type { KoseController } from './controller';
import { buildDebugExport } from './debugExport';
import { ReviewView } from './ReviewView';
import { SessionBar } from './SessionBar';
import { SettingsFooter } from './SettingsFooter';

export function App({ controller }: { controller: KoseController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!snapshot) return <div className="loading-page">読み込み中…</div>;
  const { displayed, sessions, settings, download, partialText, explainStates, chatState } = snapshot;

  return (
    <div className="layout">
      <header className="header">
        <h1>kose</h1>
        {sessions.length > 0 && (
          <SessionBar
            sessions={sessions}
            displayed={displayed}
            onSelect={(tabId) => controller.showSession(tabId)}
          />
        )}
      </header>
      <main className="main">
        {displayed ? (
          <ReviewView
            key={displayed.id}
            session={displayed}
            download={download}
            partialText={partialText}
            onRetry={() => controller.retry(displayed.source.tabId)}
            onDownload={() => controller.downloadModel(displayed.source.tabId)}
            onSelectVersion={(id) => controller.selectVersion(displayed.source.tabId, id)}
            explainStates={explainStates}
            external={settings.provider !== 'builtin'}
            onExplain={(versionId) => controller.explain(displayed.source.tabId, versionId)}
            chatState={chatState}
            onSendChat={(text) => controller.sendChat(displayed.source.tabId, text)}
            onRetryChat={() => controller.retryChat(displayed.source.tabId)}
            debugJson={() =>
              buildDebugExport(displayed, settings, {
                extensionVersion: chrome.runtime.getManifest().version,
                userAgent: navigator.userAgent,
                exportedAt: new Date(),
              })
            }
          />
        ) : (
          <EmptyState />
        )}
      </main>
      <SettingsFooter
        settings={settings}
        canRegenerate={!!displayed && displayed.status.kind !== 'running'}
        onChange={(patch) => controller.updateSettings(patch)}
        onRegenerate={() => displayed && controller.regenerate(displayed.source.tabId)}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <p>Webページで文章を選択し、右クリック →「kose」→「よい日本語にする」または「よい英語にする」を選んでください。</p>
      <p>タブごとにレビューが保持され、ブラウザでタブを切り替えると表示も切り替わります。</p>
    </div>
  );
}
