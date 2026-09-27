import { useEffect, useState } from 'react';
import { ANTHROPIC_ORIGIN } from '../ai/anthropicProvider';
import { BuiltinProvider } from '../ai/builtinProvider';
import { OPENAI_ORIGIN } from '../ai/openaiProvider';
import type { ProviderAvailability } from '../ai/provider';
import { LANGUAGE_CODES, LanguageCode, MistakeCard } from '../domain/types';
import { M } from '../shared/messages';
import {
  ANTHROPIC_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  loadSettings,
  saveSettings,
  Settings,
} from '../storage/settings';
import {
  clearMistakes,
  deleteMistake,
  exportMistakes,
  importMistakes,
  loadMistakes,
  onMistakesChanged,
} from '../storage/mistakeStore';

/** クラウドプロバイダーごとの接続先（選んだときだけ許可を求め、外したら返す） */
const CLOUD_ORIGINS: Record<'openai' | 'anthropic', { origin: string; host: string; name: string }> = {
  openai: { origin: OPENAI_ORIGIN, host: 'api.openai.com', name: 'OpenAI' },
  anthropic: { origin: ANTHROPIC_ORIGIN, host: 'api.anthropic.com', name: 'Claude' },
};

export function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  if (!settings) return null;

  const save = async (patch: Partial<Settings>, note = M.options.saved) => {
    setSettings(await saveSettings(patch));
    setMessage(note);
  };

  const chooseProvider = async (provider: Settings['provider']) => {
    if (provider !== 'builtin') {
      const { origin, host, name } = CLOUD_ORIGINS[provider];
      // クリック（ユーザー操作）の中で許可を求める
      if (!(await chrome.permissions.request({ origins: [origin] }))) {
        setMessage(M.options.notGranted(host, name));
        return;
      }
    }
    const unused = Object.entries(CLOUD_ORIGINS)
      .filter(([id]) => id !== provider)
      .map(([, c]) => c.origin);
    await chrome.permissions.remove({ origins: unused });
    await save({ provider });
  };

  return (
    <main className="options">
      <h1>{M.options.title}</h1>

      <section>
        <h2>{M.options.provider}</h2>
        <label className="radio">
          <input
            type="radio"
            name="provider"
            checked={settings.provider === 'builtin'}
            onChange={() => chooseProvider('builtin')}
          />
          <span>
            <strong>{M.options.builtin}</strong>
            <br />
            {M.options.builtinNote}
          </span>
        </label>
        <BuiltinStatus />
        <label className="radio">
          <input
            type="radio"
            name="provider"
            checked={settings.provider === 'anthropic'}
            onChange={() => chooseProvider('anthropic')}
          />
          <span>
            <strong>{M.options.claude}</strong>
            <br />
            {M.options.sentTo[0]} <code>api.anthropic.com</code>
            {M.options.sentTo[1]}
          </span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="provider"
            checked={settings.provider === 'openai'}
            onChange={() => chooseProvider('openai')}
          />
          <span>
            <strong>{M.options.openai}</strong>
            <br />
            {M.options.sentTo[0]} <code>api.openai.com</code>
            {M.options.sentTo[1]}
          </span>
        </label>
        <p className="hint">{M.options.noFallback}</p>
      </section>

      <CloudSection
        title={M.options.claude}
        keyPlaceholder="sk-ant-..."
        defaultModel={DEFAULT_ANTHROPIC_MODEL}
        modelOptions={ANTHROPIC_MODELS}
        effortOptions={[
          { id: 'low', label: M.options.effortLow },
          { id: 'medium', label: 'medium' },
          { id: 'high', label: M.options.effortHigh },
        ]}
        values={{
          apiKey: settings.anthropicApiKey,
          model: settings.anthropicModel,
          maxChars: settings.anthropicMaxInputChars,
          effort: settings.anthropicEffort,
          explainModel: settings.anthropicExplainModel,
        }}
        onSave={(v) =>
          save({
            anthropicApiKey: v.apiKey,
            anthropicModel: v.model,
            anthropicMaxInputChars: v.maxChars,
            anthropicEffort: v.effort as Settings['anthropicEffort'],
            anthropicExplainModel: v.explainModel,
          })
        }
      />

      <CloudSection
        title={M.options.openai}
        keyPlaceholder="sk-..."
        defaultModel={DEFAULT_OPENAI_MODEL}
        values={{ apiKey: settings.openaiApiKey, model: settings.openaiModel, maxChars: settings.openaiMaxInputChars }}
        onSave={(v) => save({ openaiApiKey: v.apiKey, openaiModel: v.model, openaiMaxInputChars: v.maxChars })}
      />

      <section>
        <h2>{M.options.explanation}</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.autoExplainCloud}
            onChange={(e) => save({ autoExplainCloud: e.target.checked })}
          />
          {M.options.autoExplainCloud}
        </label>
        <p className="hint">
          {M.options.autoExplainNote}
        </p>
      </section>

      <MistakesSection settings={settings} save={save} />

      <section>
        <h2>{M.options.window}</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.focusOnInvoke}
            onChange={(e) => save({ focusOnInvoke: e.target.checked })}
          />
          {M.options.focusOnInvoke}
        </label>
      </section>

      <p className="message" role="status">
        {message}
      </p>
    </main>
  );
}

function MistakesSection({
  settings,
  save,
}: {
  settings: Settings;
  save: (patch: Partial<Settings>, note?: string) => Promise<void>;
}) {
  const [cards, setCards] = useState<MistakeCard[] | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    loadMistakes().then(setCards);
    // koseウィンドウで記録・復習した分もそのまま反映する
    return onMistakesChanged(setCards);
  }, []);

  const exportFile = () => {
    const blob = new Blob([exportMistakes(cards ?? [])], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kose-mistakes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const added = await importMistakes(await file.text());
      setNote(M.options.imported(added));
    } catch (e) {
      setNote(M.options.importFailed(e instanceof Error ? e.message : String(e)));
    }
  };

  const clearAll = async () => {
    if (!cards?.length || !confirm(M.options.confirmDeleteAll(cards.length))) return;
    await clearMistakes();
    setNote(M.options.deletedAll);
  };

  const sorted = [...(cards ?? [])].sort((a, b) => b.lastSeenAt - a.lastSeenAt);

  return (
    <section>
      <h2>{M.options.mistakes}</h2>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.autoSaveMistakes}
          onChange={(e) => save({ autoSaveMistakes: e.target.checked })}
        />
        {M.options.autoSaveMistakes}
      </label>
      <p className="hint">
        {M.options.autoSaveNote}
      </p>
      <p className="hint">
        {M.options.fromExplanationNote}
      </p>
      {settings.autoSaveMistakes && settings.provider !== 'builtin' && !settings.autoExplainCloud && (
        <p className="hint warn">
          {M.options.noAutoExplainWarning}
        </p>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.quizWhileWaiting}
          onChange={(e) => save({ quizWhileWaiting: e.target.checked })}
        />
        {M.options.quizWhileWaiting}
      </label>

      <h3 className="mistakes-head">{M.options.savedMistakes(cards?.length ?? 0)}</h3>
      <div className="actions">
        <button onClick={exportFile} disabled={!cards?.length}>
          {M.options.exportJson}
        </button>
        <label className="file-button">
          {M.options.importJson}
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              importFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button className="danger" onClick={clearAll} disabled={!cards?.length}>
          {M.options.deleteAll}
        </button>
      </div>
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
      {cards && cards.length === 0 ? (
        <p className="hint">{M.options.noMistakes}</p>
      ) : (
        <ul className="mistakes">
          {sorted.map((c) => (
            <li key={c.id}>
              <div className="mistake-pair">
                <del>{c.before}</del> → <ins>{c.after}</ins>
              </div>
              {c.explanation && <p className="hint">{c.explanation}</p>}
              <div className="mistake-meta">
                <span>
                  {M.options.mistakeMeta(
                    M.languages[c.language].name,
                    c.count,
                    formatDate(c.lastSeenAt),
                    c.review.dueAt <= Date.now() ? M.options.now : formatDate(c.review.dueAt),
                  )}
                </span>
                <button className="link" onClick={() => deleteMistake(c.id)}>
                  {M.options.delete}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

interface CloudValues {
  apiKey: string;
  model: string;
  maxChars: number;
  effort?: string;
  /** 解説（2段目）のモデル。指定したプロバイダーだけ */
  explainModel?: string;
}

function CloudSection({
  title,
  keyPlaceholder,
  defaultModel,
  modelOptions,
  effortOptions,
  values,
  onSave,
}: {
  title: string;
  keyPlaceholder: string;
  defaultModel: string;
  /** 指定するとモデル欄をドロップダウンにする（一覧にないモデルは「その他」で手入力） */
  modelOptions?: { id: string; label: string }[];
  /** 指定すると「思考の深さ」欄を出す */
  effortOptions?: { id: string; label: string }[];
  values: CloudValues;
  onSave: (values: CloudValues) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState(values.apiKey);
  const [model, setModel] = useState(values.model);
  const [maxChars, setMaxChars] = useState(values.maxChars);
  const [effort, setEffort] = useState(values.effort);
  const [explainModel, setExplainModel] = useState(values.explainModel);
  const [saved, setSaved] = useState<string | null>(null);

  // 保存後は保存済みの値（空のモデル名は既定値に補われる）に揃える
  useEffect(() => {
    setApiKey(values.apiKey);
    setModel(values.model);
    setMaxChars(values.maxChars);
    setEffort(values.effort);
    setExplainModel(values.explainModel);
  }, [values.apiKey, values.model, values.maxChars, values.effort, values.explainModel]);

  const next: CloudValues = {
    apiKey: apiKey.trim(),
    model: model.trim() || defaultModel,
    maxChars,
    effort,
    explainModel: explainModel === undefined ? undefined : explainModel.trim() || defaultModel,
  };
  const dirty =
    next.apiKey !== values.apiKey ||
    next.model !== values.model ||
    next.maxChars !== values.maxChars ||
    next.effort !== values.effort ||
    next.explainModel !== values.explainModel;

  const save = async (v: CloudValues, note: string) => {
    await onSave(v);
    setSaved(note);
    setTimeout(() => setSaved(null), 2000);
  };

  return (
    <section>
      <h2>{title}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) save(next, M.options.saved);
        }}
      >
        <label className="row">
          <span>{M.options.apiKey}</span>
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keyPlaceholder}
          />
        </label>
        <label className="row">
          <span>{explainModel === undefined ? M.options.model : M.options.rewriteModel}</span>
          {modelOptions ? (
            <ModelSelect options={modelOptions} value={model} onChange={setModel} />
          ) : (
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder={defaultModel} />
          )}
        </label>
        {explainModel !== undefined && modelOptions && (
          <label className="row">
            <span>{M.options.explainModel}</span>
            <ModelSelect options={modelOptions} value={explainModel} onChange={setExplainModel} />
          </label>
        )}
        {effortOptions && (
          <label className="row">
            <span>{M.options.effort}</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value)}>
              {effortOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="row">
          <span>{M.options.maxChars}</span>
          <input
            type="number"
            min={100}
            step={100}
            value={maxChars}
            onChange={(e) => setMaxChars(Number(e.target.value))}
          />
        </label>
        <p className="hint">
          {M.options.apiKeyNote}
        </p>
        <div className="actions">
          <button type="submit" className="primary" disabled={!dirty}>
            {dirty ? M.options.save : M.options.savedButton}
          </button>
          <button
            type="button"
            disabled={values.apiKey === ''}
            onClick={() => save({ ...values, apiKey: '' }, M.options.keyDeleted)}
          >
            {M.options.deleteKey}
          </button>
          {saved && (
            <span className="saved" role="status">
              ✓ {saved}
            </span>
          )}
          {dirty && !saved && <span className="unsaved">{M.options.unsaved}</span>}
        </div>
      </form>
    </section>
  );
}

const CUSTOM_MODEL = '__custom__';

function ModelSelect({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (model: string) => void;
}) {
  const listed = options.some((o) => o.id === value);
  const [custom, setCustom] = useState(!listed);
  return (
    <span className="model-select">
      <select
        value={custom ? CUSTOM_MODEL : value}
        onChange={(e) => {
          const next = e.target.value;
          setCustom(next === CUSTOM_MODEL);
          if (next !== CUSTOM_MODEL) onChange(next);
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        <option value={CUSTOM_MODEL}>{M.options.customModel}</option>
      </select>
      {custom && (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="claude-..." />
      )}
    </span>
  );
}

function BuiltinStatus() {
  const [states, setStates] = useState<Partial<Record<LanguageCode, ProviderAvailability>>>({});
  useEffect(() => {
    const provider = new BuiltinProvider();
    for (const code of LANGUAGE_CODES) {
      provider.availability(code).then((a) => setStates((s) => ({ ...s, [code]: a })));
    }
  }, []);
  return (
    <ul className="builtin-status">
      {LANGUAGE_CODES.map((code) => (
        <li key={code}>
          {M.languages[code].target}: {describe(states[code])}
        </li>
      ))}
    </ul>
  );
}

function describe(a: ProviderAvailability | undefined): string {
  switch (a?.kind) {
    case undefined:
      return M.options.checking;
    case 'available':
      return M.options.available;
    case 'needs-download':
      return M.options.needsDownload;
    case 'downloading':
      return M.options.downloading;
    case 'unavailable':
      return M.options.unavailable(a.reason);
  }
}
