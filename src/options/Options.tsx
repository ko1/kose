import { useEffect, useState } from 'react';
import { ANTHROPIC_ORIGIN } from '../ai/anthropicProvider';
import { BuiltinProvider } from '../ai/builtinProvider';
import { OPENAI_ORIGIN } from '../ai/openaiProvider';
import type { ProviderAvailability } from '../ai/provider';
import { LANGUAGE_CODES, LanguageCode, MistakeCard } from '../domain/types';
import { LANGUAGE_LABELS } from '../domain/labels';
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

  const save = async (patch: Partial<Settings>, note = '保存しました') => {
    setSettings(await saveSettings(patch));
    setMessage(note);
  };

  const chooseProvider = async (provider: Settings['provider']) => {
    if (provider !== 'builtin') {
      const { origin, host, name } = CLOUD_ORIGINS[provider];
      // クリック（ユーザー操作）の中で許可を求める
      if (!(await chrome.permissions.request({ origins: [origin] }))) {
        setMessage(`${host} への接続が許可されなかったため、${name}は選択されませんでした。`);
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
      <h1>kose 設定</h1>

      <section>
        <h2>AIプロバイダー</h2>
        <label className="radio">
          <input
            type="radio"
            name="provider"
            checked={settings.provider === 'builtin'}
            onChange={() => chooseProvider('builtin')}
          />
          <span>
            <strong>ローカル（Chrome内蔵AI）</strong>
            <br />
            文章は外部に送信されません。
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
            <strong>Claude（Anthropic API）</strong>
            <br />
            選択した文章が <code>api.anthropic.com</code> に送信されます。利用料金はご自身のAPIキーに課金されます。
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
            <strong>OpenAI API</strong>
            <br />
            選択した文章が <code>api.openai.com</code> に送信されます。利用料金はご自身のAPIキーに課金されます。
          </span>
        </label>
        <p className="hint">Chrome内蔵AIが使えない場合でも、自動でクラウドに切り替わることはありません。</p>
      </section>

      <CloudSection
        title="Claude（Anthropic API）"
        keyPlaceholder="sk-ant-..."
        defaultModel={DEFAULT_ANTHROPIC_MODEL}
        modelOptions={ANTHROPIC_MODELS}
        effortOptions={[
          { id: 'low', label: 'low（速い・安い）' },
          { id: 'medium', label: 'medium' },
          { id: 'high', label: 'high（丁寧・遅い）' },
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
        title="OpenAI API"
        keyPlaceholder="sk-..."
        defaultModel={DEFAULT_OPENAI_MODEL}
        values={{ apiKey: settings.openaiApiKey, model: settings.openaiModel, maxChars: settings.openaiMaxInputChars }}
        onSave={(v) => save({ openaiApiKey: v.apiKey, openaiModel: v.model, openaiMaxInputChars: v.maxChars })}
      />

      <section>
        <h2>解説</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.autoExplainCloud}
            onChange={(e) => save({ autoExplainCloud: e.target.checked })}
          />
          クラウド（Claude・OpenAI）でも解説を自動で生成する
        </label>
        <p className="hint">
          オフの場合、右クリック時は改稿文だけを生成し、解説は「解説を見る」を押したときに生成します（費用を抑えられます）。Chrome内蔵AIでは常に自動で生成します。
        </p>
      </section>

      <MistakesSection settings={settings} save={save} />

      <section>
        <h2>ウィンドウ</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.focusOnInvoke}
            onChange={(e) => save({ focusOnInvoke: e.target.checked })}
          />
          koseを実行したときにkoseウィンドウを前面に出す
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
      setNote(`${added}件を読み込みました（既にある間違いは読み込みません）`);
    } catch (e) {
      setNote(`読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const clearAll = async () => {
    if (!cards?.length || !confirm(`記録した間違い ${cards.length} 件をすべて削除します。元に戻せません。`)) return;
    await clearMistakes();
    setNote('すべて削除しました');
  };

  const sorted = [...(cards ?? [])].sort((a, b) => b.lastSeenAt - a.lastSeenAt);

  return (
    <section>
      <h2>間違いの記録と復習</h2>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.autoSaveMistakes}
          onChange={(e) => save({ autoSaveMistakes: e.target.checked })}
        />
        同じ言語の校正で見つかった誤りを自動で記録する
      </label>
      <p className="hint">
        記録するのは文法・語法・表記の客観的な誤りだけで、言い換えや翻訳は記録しません。保存するのは誤った語句と直した語句、解説だけで、原文全体やページのURLは保存しません。
      </p>
      <p className="hint">
        間違いは<strong>解説</strong>の変更点から記録するため、解説を生成したときだけ増えます。Chrome内蔵AIでは解説を自動で生成します。クラウド（Claude・OpenAI）では、上の「解説」で自動生成をオンにするか、koseウィンドウで「解説を見る」を押したときに記録されます。
      </p>
      {settings.autoSaveMistakes && settings.provider !== 'builtin' && !settings.autoExplainCloud && (
        <p className="hint warn">
          現在はクラウドで解説を自動生成しない設定のため、「解説を見る」を押さない限り間違いは記録されません。
        </p>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.quizWhileWaiting}
          onChange={(e) => save({ quizWhileWaiting: e.target.checked })}
        />
        改稿を待つ間に、復習の時期が来た間違いを1問出す
      </label>

      <h3 className="mistakes-head">記録した間違い（{cards?.length ?? 0}件）</h3>
      <div className="actions">
        <button onClick={exportFile} disabled={!cards?.length}>
          JSONに書き出す
        </button>
        <label className="file-button">
          JSONから読み込む
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
          すべて削除
        </button>
      </div>
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
      {cards && cards.length === 0 ? (
        <p className="hint">まだ記録はありません。</p>
      ) : (
        <ul className="mistakes">
          {sorted.map((c) => (
            <li key={c.id}>
              <div className="mistake-pair">
                <del>{c.before}</del> → <ins>{c.after}</ins>
              </div>
              {c.explanationJa && <p className="hint">{c.explanationJa}</p>}
              <div className="mistake-meta">
                <span>
                  {LANGUAGE_LABELS[c.language].name}・{c.count}回・最終 {formatDate(c.lastSeenAt)}・次の復習{' '}
                  {c.review.dueAt <= Date.now() ? '今すぐ' : formatDate(c.review.dueAt)}
                </span>
                <button className="link" onClick={() => deleteMistake(c.id)}>
                  削除
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
  return new Date(ms).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
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
          if (dirty) save(next, '保存しました');
        }}
      >
        <label className="row">
          <span>APIキー</span>
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keyPlaceholder}
          />
        </label>
        <label className="row">
          <span>{explainModel === undefined ? 'モデル' : '改稿のモデル'}</span>
          {modelOptions ? (
            <ModelSelect options={modelOptions} value={model} onChange={setModel} />
          ) : (
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder={defaultModel} />
          )}
        </label>
        {explainModel !== undefined && modelOptions && (
          <label className="row">
            <span>解説・相談のモデル</span>
            <ModelSelect options={modelOptions} value={explainModel} onChange={setExplainModel} />
          </label>
        )}
        {effortOptions && (
          <label className="row">
            <span>思考の深さ</span>
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
          <span>入力の上限（文字）</span>
          <input
            type="number"
            min={100}
            step={100}
            value={maxChars}
            onChange={(e) => setMaxChars(Number(e.target.value))}
          />
        </label>
        <p className="hint">
          APIキーはこのブラウザーの拡張機能ストレージ（chrome.storage.local）に保存されます。暗号化されたセキュアストレージではありません。
        </p>
        <div className="actions">
          <button type="submit" className="primary" disabled={!dirty}>
            {dirty ? '保存' : '保存済み'}
          </button>
          <button
            type="button"
            disabled={values.apiKey === ''}
            onClick={() => save({ ...values, apiKey: '' }, 'APIキーを削除しました')}
          >
            APIキーを削除
          </button>
          {saved && (
            <span className="saved" role="status">
              ✓ {saved}
            </span>
          )}
          {dirty && !saved && <span className="unsaved">未保存の変更があります</span>}
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
        <option value={CUSTOM_MODEL}>その他（モデル名を入力）</option>
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
          {LANGUAGE_LABELS[code].target}: {describe(states[code])}
        </li>
      ))}
    </ul>
  );
}

function describe(a: ProviderAvailability | undefined): string {
  switch (a?.kind) {
    case undefined:
      return '確認中…';
    case 'available':
      return '利用可能';
    case 'needs-download':
      return 'モデルのダウンロードが必要（初回実行時にkoseウィンドウから開始できます）';
    case 'downloading':
      return 'モデルをダウンロード中';
    case 'unavailable':
      return `利用不可 — ${a.reason}`;
  }
}
