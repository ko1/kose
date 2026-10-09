import { LANGUAGE_CODES, Situation, SITUATIONS } from '../domain/types';
import { M } from '../shared/messages';
import type { Settings } from '../storage/settings';

/**
 * 機能（Make it good Japanese / English）・用途。次回の実行にも使うので、ウィンドウの一番上に置く。
 * kose ボタンは表示中の原文を作り直す。自由入力では入力欄の kose ボタンがあるので出さない
 */
export function SettingsBar({
  settings,
  canRegenerate,
  showRegenerate,
  onChange,
  onRegenerate,
}: {
  settings: Settings;
  canRegenerate: boolean;
  showRegenerate: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="settings-bar">
      <div className="field">
        <span className="label" id="target-label">
          {M.settingsBar.target}
        </span>
        <div className="target-choice" role="group" aria-labelledby="target-label">
          {M.settingsBar.targetPrefix}
          <span className="segmented">
            {LANGUAGE_CODES.map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={settings.targetLanguage === code}
                onClick={() => onChange({ targetLanguage: code })}
              >
                {M.languages[code].name}
              </button>
            ))}
          </span>
          {M.settingsBar.targetSuffix}
        </div>
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
      {showRegenerate && (
        <button className="primary" disabled={!canRegenerate} onClick={onRegenerate} title={M.settingsBar.applyTitle}>
          {M.settingsBar.apply}
        </button>
      )}
    </div>
  );
}

export function ProviderFooter({ settings }: { settings: Settings }) {
  return (
    <footer className="footer">
      <div className="provider">
        <ProviderLabel settings={settings} />
        <button className="link" onClick={() => chrome.runtime.openOptionsPage()} title={M.settingsBar.settingsTitle}>
          {M.settingsBar.settings}
        </button>
      </div>
    </footer>
  );
}

function ProviderLabel({ settings }: { settings: Settings }) {
  switch (settings.provider) {
    case 'builtin':
      return <span>{M.settingsBar.local}</span>;
    case 'ollama':
      return <span>{M.settingsBar.localOllama(settings.ollamaModel)}</span>;
    case 'anthropic':
      return (
        <span className="external">
          {M.settingsBar.externalAnthropic(settings.anthropicModel, settings.anthropicExplainModel)}
        </span>
      );
    case 'openai':
      return <span className="external">{M.settingsBar.external('OpenAI', settings.openaiModel)}</span>;
    case 'gemini':
      return <span className="external">{M.settingsBar.external('Gemini', settings.geminiModel)}</span>;
    case 'openrouter':
      return <span className="external">{M.settingsBar.external('OpenRouter', settings.openrouterModel)}</span>;
  }
}
