import { z } from 'zod';
import { LANGUAGE_CODES, SITUATIONS } from '../domain/types';

export const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';
export const DEFAULT_ANTHROPIC_EXPLAIN_MODEL = 'claude-sonnet-5';

/** 設定画面のモデル選択肢（料金は入力/出力、100万トークンあたり） */
export const ANTHROPIC_MODELS: { id: string; label: string }[] = [
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — 速い・安い（$1 / $5）' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — バランス（$2 / $10）' },
  { id: 'claude-opus-5', label: 'Claude Opus 5 — 高品質（$5 / $25）' },
];

const settingsSchema = z.object({
  provider: z.enum(['builtin', 'openai', 'anthropic']).catch('builtin'),
  targetLanguage: z.enum(LANGUAGE_CODES).catch('en'),
  situation: z.enum(SITUATIONS).catch('casual'),
  openaiApiKey: z.string().catch(''),
  openaiModel: z.string().min(1).catch(DEFAULT_OPENAI_MODEL),
  openaiMaxInputChars: z.number().int().positive().catch(4000),
  anthropicApiKey: z.string().catch(''),
  anthropicModel: z.string().min(1).catch(DEFAULT_ANTHROPIC_MODEL),
  /** 解説（2段目）のモデル。押したときだけ使うので、改稿より上のモデルを既定にする */
  anthropicExplainModel: z.string().min(1).catch(DEFAULT_ANTHROPIC_EXPLAIN_MODEL),
  /** 思考の深さ。校正・翻訳は速さを優先して low を既定にする */
  anthropicEffort: z.enum(['low', 'medium', 'high']).catch('low'),
  anthropicMaxInputChars: z.number().int().positive().catch(4000),
  focusOnInvoke: z.boolean().catch(true),
  /** クラウド利用時も解説（2段目）を自動で生成するか。費用が数倍になるので既定はオフ */
  autoExplainCloud: z.boolean().catch(false),
});

export type Settings = z.infer<typeof settingsSchema>;

const KEY = 'settings';

/** 保存値が欠けている・壊れている項目は既定値で補う */
export function normalizeSettings(raw: unknown): Settings {
  return settingsSchema.parse(typeof raw === 'object' && raw !== null ? raw : {});
}

export const DEFAULT_SETTINGS: Settings = normalizeSettings({});

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return normalizeSettings(stored[KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && KEY in changes) listener(normalizeSettings(changes[KEY].newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
