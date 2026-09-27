import { LANGUAGE_CODES, LanguageCode, Situation, SITUATIONS } from '../domain/types';
import { M } from '../shared/messages';
import type { Settings } from '../storage/settings';

/** 機能（Make it good Japanese / English）・用途。次回の実行にも使うので、ウィンドウの一番上に置く */
export function SettingsBar({
  settings,
  canRegenerate,
  onChange,
  onRegenerate,
}: {
  settings: Settings;
  canRegenerate: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="settings-bar">
      <div className="field">
        <label htmlFor="target">{M.settingsBar.target}</label>
        <select
          id="target"
          value={settings.targetLanguage}
          onChange={(e) => onChange({ targetLanguage: e.target.value as LanguageCode })}
        >
          {LANGUAGE_CODES.map((code) => (
            <option key={code} value={code}>
              {M.settingsBar.targetOption(M.languages[code].target)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="situation">{M.settingsBar.situation}</label>
        <select
          id="situation"
          value={settings.situation}
          onChange={(e) => onChange({ situation: e.target.value as Situation })}
        >
          {SITUATIONS.map((id) => (
            <option key={id} value={id}>
              {M.situations[id]}
            </option>
          ))}
        </select>
      </div>
      <button
        className="primary"
        disabled={!canRegenerate}
        onClick={onRegenerate}
        title={M.settingsBar.applyTitle}
      >
        {M.settingsBar.apply}
      </button>
    </div>
  );
}

export function ProviderFooter({ settings }: { settings: Settings }) {
  return (
    <footer className="footer">
      <div className="provider">
        {settings.provider === 'openai' ? (
          <span className="external">{M.settingsBar.externalOpenAI(settings.openaiModel)}</span>
        ) : settings.provider === 'anthropic' ? (
          <span className="external">
            {M.settingsBar.externalAnthropic(settings.anthropicModel, settings.anthropicExplainModel)}
          </span>
        ) : (
          <span>{M.settingsBar.local}</span>
        )}
        <button className="link" onClick={() => chrome.runtime.openOptionsPage()} title={M.settingsBar.settingsTitle}>
          {M.settingsBar.settings}
        </button>
      </div>
    </footer>
  );
}
