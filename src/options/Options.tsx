import { ReactNode, useEffect, useState } from 'react';
import { ANTHROPIC_ORIGIN } from '../ai/anthropicProvider';
import { BuiltinProvider } from '../ai/builtinProvider';
import { compatibleSpec } from '../ai/factory';
import { GEMINI_ORIGIN, OPENAI_ORIGIN, OPENROUTER_ORIGIN } from '../ai/openaiProvider';
import { loginWithOpenRouter } from '../ai/openrouterAuth';
import type { ProviderAvailability } from '../ai/provider';
import { LANGUAGE_CODES, LanguageCode, MistakeCard } from '../domain/types';
import { launchCommand, windowsSetupScript } from '../shared/launcher';
import { paginate } from '../shared/paginate';
import { M } from '../shared/messages';
import {
  ANTHROPIC_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  loadSettings,
  PROVIDERS,
  ProviderSetting,
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

interface AccessTarget {
  origin: string;
  host: string;
  name: string;
}

/** プロバイダーの接続先（選んだときだけ許可を求め、外したら返す）。Chrome内蔵AIは null */
function accessTarget(settings: Settings): AccessTarget | null {
  if (settings.provider === 'builtin') return null;
  if (settings.provider === 'anthropic') return { origin: ANTHROPIC_ORIGIN, host: 'api.anthropic.com', name: 'Claude' };
  const spec = compatibleSpec(settings);
  return { origin: spec.origin, host: spec.host, name: spec.name };
}

/** 許可を求めうるすべての接続先（manifest の optional_host_permissions と揃える） */
const ALL_ORIGINS = [
  ANTHROPIC_ORIGIN,
  OPENAI_ORIGIN,
  GEMINI_ORIGIN,
  OPENROUTER_ORIGIN,
  'http://localhost/*',
  'http://127.0.0.1/*',
];

const PROVIDER_LABELS: Record<ProviderSetting, () => string> = {
  builtin: () => M.options.builtin,
  anthropic: () => M.options.claude,
  openai: () => M.options.openai,
  gemini: () => M.options.gemini,
  openrouter: () => M.options.openrouter,
  ollama: () => M.options.ollama,
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

  return (
    <main className="options">
      <h1>{M.options.title}</h1>

      <ProviderSection settings={settings} save={save} setMessage={setMessage} />

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

      <LauncherSection />

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

/**
 * AIプロバイダーの選択。ドロップダウンで選び、選んだものに必要な設定（APIキーなど）だけを下に出す。
 * 接続先があるものは選んだときに接続の許可を求め、使わなくなった接続先の許可は返す。
 */
function ProviderSection({
  settings,
  save,
  setMessage,
}: {
  settings: Settings;
  save: (patch: Partial<Settings>, note?: string) => Promise<void>;
  setMessage: (message: string) => void;
}) {
  const provider = settings.provider;
  const target = accessTarget(settings);
  const [granted, setGranted] = useState<boolean | null>(null);

  useEffect(() => {
    setGranted(null);
    if (target) chrome.permissions.contains({ origins: [target.origin] }).then(setGranted);
  }, [target?.origin]);

  /** 接続の許可を求める。ユーザー操作の中でしか求められないので、失敗したらボタンから求め直せるようにする */
  const requestAccess = async (next: AccessTarget | null) => {
    if (!next) return;
    let ok = false;
    try {
      ok = await chrome.permissions.request({ origins: [next.origin] });
    } catch {
      ok = false;
    }
    setGranted(ok);
    if (!ok) setMessage(M.options.notGranted(next.host, next.name));
  };

  const choose = async (next: ProviderSetting) => {
    const nextTarget = accessTarget({ ...settings, provider: next });
    await save({ provider: next });
    await requestAccess(nextTarget);
    await chrome.permissions.remove({ origins: ALL_ORIGINS.filter((o) => o !== nextTarget?.origin) });
  };

  const loginOpenRouter = async () => {
    try {
      const key = await loginWithOpenRouter();
      await save({ openrouterApiKey: key }, M.options.openrouterLoggedIn);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <h2>{M.options.provider}</h2>
      <select
        className="provider-select"
        value={provider}
        onChange={(e) => choose(e.target.value as ProviderSetting)}
        aria-label={M.options.provider}
      >
        {PROVIDERS.map((id) => (
          <option key={id} value={id}>
            {PROVIDER_LABELS[id]()}
          </option>
        ))}
      </select>

      {provider === 'builtin' ? (
        <p className="hint">{M.options.builtinNote}</p>
      ) : provider === 'ollama' ? (
        <p className="hint">{M.options.ollamaNote}</p>
      ) : (
        target && (
          <p className="hint">
            {M.options.sentTo[0]} <code>{target.host}</code>
            {M.options.sentTo[1]}
          </p>
        )
      )}
      {provider === 'gemini' && <p className="hint">{M.options.geminiNote}</p>}
      {provider === 'openrouter' && <p className="hint">{M.options.openrouterNote}</p>}

      {target && granted === false && (
        <p className="hint warn">
          {M.options.needsAccess(target.host)}{' '}
          <button onClick={() => requestAccess(target)}>{M.options.allowAccess(target.host)}</button>
        </p>
      )}

      {provider === 'builtin' && <BuiltinStatus />}

      {provider === 'anthropic' && (
        <CloudSettings
          keyPlaceholder="sk-ant-..."
          defaultModel={DEFAULT_ANTHROPIC_MODEL}
          modelOptions={ANTHROPIC_MODELS.map((m) => ({
            id: m.id,
            label: `${m.name} — ${M.options.modelTiers[m.tier]} (${m.price})`,
          }))}
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
      )}

      {provider === 'openai' && (
        <CloudSettings
          keyPlaceholder="sk-..."
          defaultModel={DEFAULT_OPENAI_MODEL}
          values={{ apiKey: settings.openaiApiKey, model: settings.openaiModel, maxChars: settings.openaiMaxInputChars }}
          onSave={(v) => save({ openaiApiKey: v.apiKey, openaiModel: v.model, openaiMaxInputChars: v.maxChars })}
        />
      )}

      {provider === 'gemini' && (
        <CloudSettings
          keyPlaceholder="AIza..."
          defaultModel={DEFAULT_GEMINI_MODEL}
          values={{ apiKey: settings.geminiApiKey, model: settings.geminiModel, maxChars: settings.geminiMaxInputChars }}
          onSave={(v) => save({ geminiApiKey: v.apiKey, geminiModel: v.model, geminiMaxInputChars: v.maxChars })}
        />
      )}

      {provider === 'openrouter' && (
        <CloudSettings
          keyPlaceholder="sk-or-..."
          defaultModel={DEFAULT_OPENROUTER_MODEL}
          modelHint={M.options.openrouterModelHint}
          extra={
            <p>
              <button className="primary" onClick={loginOpenRouter}>
                {M.options.openrouterLogin}
              </button>{' '}
              <span className="hint">{M.options.openrouterLoginNote}</span>
            </p>
          }
          values={{
            apiKey: settings.openrouterApiKey,
            model: settings.openrouterModel,
            maxChars: settings.openrouterMaxInputChars,
          }}
          onSave={(v) =>
            save({ openrouterApiKey: v.apiKey, openrouterModel: v.model, openrouterMaxInputChars: v.maxChars })
          }
        />
      )}

      {provider === 'ollama' && (
        <CloudSettings
          keyLabel={M.options.serverUrl}
          keyPlaceholder={DEFAULT_OLLAMA_URL}
          secret={false}
          defaultModel={DEFAULT_OLLAMA_MODEL}
          modelHint={M.options.ollamaModelHint}
          values={{ apiKey: settings.ollamaUrl, model: settings.ollamaModel, maxChars: settings.ollamaMaxInputChars }}
          onSave={(v) =>
            save({ ollamaUrl: v.apiKey || DEFAULT_OLLAMA_URL, ollamaModel: v.model, ollamaMaxInputChars: v.maxChars })
          }
        />
      )}

      <p className="hint">{M.options.noFallback}</p>
    </section>
  );
}

/** ほかのアプリから起動するためのコマンド（この拡張の ID 入り）を表示してコピーできるようにする */
function LauncherSection() {
  const [os, setOs] = useState<string | null>(null);
  useEffect(() => {
    chrome.runtime.getPlatformInfo().then((info) => setOs(info.os));
  }, []);
  if (os === null) return null;

  const url = chrome.runtime.getURL('launch.html');
  const command = launchCommand(os, url);
  return (
    <section>
      <h2>{M.launcher.heading}</h2>
      <p className="hint">{M.launcher.intro}</p>
      {os === 'win' ? (
        <>
          <p className="hint">{M.launcher.winSetup}</p>
          <CopyBlock text={windowsSetupScript(url)} />
          <p className="hint">{M.launcher.winShortcut}</p>
          <CopyBlock text={command} />
          <p className="hint">{M.launcher.win}</p>
        </>
      ) : (
        <>
          <CopyBlock text={command} />
          <p className="hint">{os === 'mac' ? M.launcher.mac : M.launcher.other}</p>
        </>
      )}
    </section>
  );
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="command">
      <pre>
        <code>{text}</code>
      </pre>
      <button onClick={copy}>{copied ? M.launcher.copied : M.launcher.copy}</button>
    </div>
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
        // 長くなるので既定では閉じ、開いたらページ送りで見せる
        <details className="mistakes-list">
          <summary>{M.options.savedMistakes(cards?.length ?? 0)}</summary>
          <MistakeList cards={sorted} />
        </details>
      )}
    </section>
  );
}

const MISTAKES_PER_PAGE = 20;

function MistakeList({ cards }: { cards: MistakeCard[] }) {
  const [page, setPage] = useState(0);
  const view = paginate(cards, page, MISTAKES_PER_PAGE);
  const nav = view.pages > 1 && (
    <div className="pager">
      <button disabled={view.page === 0} onClick={() => setPage(view.page - 1)}>
        {M.options.prevPage}
      </button>
      <span className="hint">{M.options.pageOf(view.page + 1, view.pages)}</span>
      <button disabled={view.page >= view.pages - 1} onClick={() => setPage(view.page + 1)}>
        {M.options.nextPage}
      </button>
    </div>
  );
  return (
    <>
      <ul className="mistakes">
        {view.items.map((c) => (
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
      {nav}
    </>
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

function CloudSettings({
  keyPlaceholder,
  keyLabel = M.options.apiKey,
  secret = true,
  extra,
  modelHint,
  defaultModel,
  modelOptions,
  effortOptions,
  values,
  onSave,
}: {
  keyPlaceholder: string;
  /** 1行目の欄の名前。Ollama では API キーの代わりにサーバーの URL を入れる */
  keyLabel?: string;
  /** API キー（伏せ字で表示し、削除ボタンと保存先の注意を出す）か */
  secret?: boolean;
  /** 欄の上に出す追加の操作（OpenRouter のログインなど） */
  extra?: ReactNode;
  /** モデル欄の下に出す補足 */
  modelHint?: string;
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
    <div className="provider-settings">
      {extra}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) save(next, M.options.saved);
        }}
      >
        <label className="row">
          <span>{keyLabel}</span>
          <input
            type={secret ? 'password' : 'text'}
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
        {modelHint && <p className="hint">{modelHint}</p>}
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
        {secret && <p className="hint">{M.options.apiKeyNote}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={!dirty}>
            {dirty ? M.options.save : M.options.savedButton}
          </button>
          {secret && (
            <button
              type="button"
              disabled={values.apiKey === ''}
              onClick={() => save({ ...values, apiKey: '' }, M.options.keyDeleted)}
            >
              {M.options.deleteKey}
            </button>
          )}
          {saved && (
            <span className="saved" role="status">
              ✓ {saved}
            </span>
          )}
          {dirty && !saved && <span className="unsaved">{M.options.unsaved}</span>}
        </div>
      </form>
    </div>
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
