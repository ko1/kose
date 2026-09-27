import { LANGUAGE_LABELS, SITUATION_LABELS } from '../domain/labels';
import { LANGUAGE_CODES, LanguageCode, Situation, SITUATIONS } from '../domain/types';
import type { Settings } from '../storage/settings';

/** 機能（よい日本語／よい英語にする）・用途。次回の実行にも使うので、ウィンドウの一番上に置く */
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
        <label htmlFor="target">機能</label>
        <select
          id="target"
          value={settings.targetLanguage}
          onChange={(e) => onChange({ targetLanguage: e.target.value as LanguageCode })}
        >
          {LANGUAGE_CODES.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_LABELS[code].target}にする
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="situation">用途</label>
        <select
          id="situation"
          value={settings.situation}
          onChange={(e) => onChange({ situation: e.target.value as Situation })}
        >
          {SITUATIONS.map((id) => (
            <option key={id} value={id}>
              {SITUATION_LABELS[id].name}
            </option>
          ))}
        </select>
      </div>
      <button
        className="primary"
        disabled={!canRegenerate}
        onClick={onRegenerate}
        title="表示中の案と機能・用途が違うときに、同じ原文から作り直します"
      >
        変更
      </button>
    </div>
  );
}

export function ProviderFooter({ settings }: { settings: Settings }) {
  return (
    <footer className="footer">
      <div className="provider">
        {settings.provider === 'openai' ? (
          <span className="external">外部送信: OpenAI（{settings.openaiModel}）</span>
        ) : settings.provider === 'anthropic' ? (
          <span className="external">
            外部送信: Anthropic（改稿 {settings.anthropicModel} / 解説・相談 {settings.anthropicExplainModel}）
          </span>
        ) : (
          <span>AI: ローカル（Chrome内蔵）</span>
        )}
        <button className="link" onClick={() => chrome.runtime.openOptionsPage()} title="設定を開く">
          ⚙ 設定
        </button>
      </div>
    </footer>
  );
}
