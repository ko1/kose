import { useEffect, useState, useSyncExternalStore } from 'react';
import { currentVersion, SCRATCH_TAB_ID } from '../domain/session';
import type { MistakeCard, Rating, ReviewSession } from '../domain/types';
import { M } from '../shared/messages';
import type { Settings } from '../storage/settings';
import type { KoseController } from './controller';
import { buildDebugExport } from './debugExport';
import { ReviewView } from './ReviewView';
import { ScratchView } from './ScratchView';
import { SessionBar } from './SessionBar';
import { QuizCard } from './QuizCard';
import { ProviderFooter, SettingsBar } from './SettingsBar';

export function App({ controller }: { controller: KoseController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  /** まとめて復習中なら、始めた時点で期限が来ていたカード */
  const [reviewing, setReviewing] = useState<MistakeCard[] | null>(null);
  // 新しく kose を実行したら、その結果を見せるため復習をやめる
  const newestId = snapshot?.sessions[0]?.id;
  useEffect(() => setReviewing(null), [newestId]);
  if (!snapshot) return <div className="loading-page">{M.window.loading}</div>;
  const { displayed, displayedTabId, sessions, settings, download, partialText, explainStates, chatState } = snapshot;
  const { quizCard, dueCards, scratch } = snapshot;
  const showingScratch = displayedTabId === SCRATCH_TAB_ID;

  return (
    <div className="layout">
      <header className="header">
        <h1>kose</h1>
        <SessionBar
          sessions={sessions}
          displayedTabId={displayedTabId}
          onSelect={(tabId) => {
            setReviewing(null);
            controller.showSession(tabId);
          }}
        />
        {reviewing === null && dueCards.length > 0 && (
          <button className="review-button" onClick={() => setReviewing(dueCards)} title={M.window.reviewButtonTitle}>
            {M.window.reviewButton(dueCards.length)}
          </button>
        )}
      </header>
      <SettingsBar
        settings={settings}
        canRegenerate={!!displayed && displayed.status.kind !== 'running' && settingsChanged(displayed, settings)}
        onChange={(patch) => controller.updateSettings(patch)}
        onRegenerate={() => displayed && controller.regenerate(displayed.source.tabId)}
      />
      <main className="main">
        {reviewing ? (
          <ReviewQuiz
            cards={reviewing}
            onRate={(id, rating) => controller.rateCard(id, rating)}
            onClose={() => setReviewing(null)}
          />
        ) : (
          <>
            {showingScratch && (
              <ScratchView
                draft={scratch.draft}
                focusSeq={scratch.focusSeq}
                running={displayed?.status.kind === 'running'}
                hasOtherSessions={sessions.some((s) => s.source.tabId !== SCRATCH_TAB_ID)}
                onChange={(draft) => controller.setScratchDraft(draft)}
                onRun={() => controller.runScratch()}
              />
            )}
            {displayed && (
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
                quizCard={quizCard}
                onRateCard={(id, rating) => controller.rateCard(id, rating)}
                debugJson={() =>
                  buildDebugExport(displayed, settings, {
                    extensionVersion: chrome.runtime.getManifest().version,
                    userAgent: navigator.userAgent,
                    exportedAt: new Date(),
                  })
                }
              />
            )}
          </>
        )}
      </main>
      <ProviderFooter settings={settings} />
    </div>
  );
}

/** 上部の機能・用途が、表示中の案（案がなければ最後に要求した設定）と違うか */
function settingsChanged(session: ReviewSession, settings: Settings): boolean {
  const shown = currentVersion(session) ?? session;
  return shown.targetLanguage !== settings.targetLanguage || shown.situation !== settings.situation;
}

/** 期限が来た間違いをまとめて復習する */
function ReviewQuiz({
  cards,
  onRate,
  onClose,
}: {
  cards: MistakeCard[];
  onRate: (cardId: string, rating: Rating) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const card = cards[index];
  return (
    <section className="section">
      <div className="section-head">
        <h2>{M.quiz.heading}</h2>
        <span className="meta">
          {card ? M.quiz.progress(index + 1, cards.length) : ''}{' '}
          <button className="link" onClick={onClose}>
            {card ? M.quiz.stop : M.quiz.back}
          </button>
        </span>
      </div>
      {card ? (
        <QuizCard key={card.id} card={card} onRate={(r) => onRate(card.id, r)} onNext={() => setIndex(index + 1)} />
      ) : (
        <p>{M.quiz.done}</p>
      )}
    </section>
  );
}
