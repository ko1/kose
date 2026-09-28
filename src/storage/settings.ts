import { z } from 'zod';
import { LANGUAGE_CODES, SITUATIONS } from '../domain/types';
import { withLock } from './lock';

export const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';
export const DEFAULT_ANTHROPIC_EXPLAIN_MODEL = 'claude-sonnet-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5-mini';
export const DEFAULT_OLLAMA_MODEL = 'qwen3';
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

export const PROVIDERS = ['builtin', 'anthropic', 'openai', 'gemini', 'openrouter', 'ollama'] as const;
export type ProviderSetting = (typeof PROVIDERS)[number];

export type ModelTier = 'fast' | 'balanced' | 'best';

/** 設定画面のモデル選択肢（料金は入力/出力、100万トークンあたり）。特徴の表示名は文言カタログにある */
export const ANTHROPIC_MODELS: { id: string; name: string; tier: ModelTier; price: string }[] = [
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', tier: 'fast', price: '$1 / $5' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', tier: 'balanced', price: '$2 / $10' },
  { id: 'claude-opus-5', name: 'Claude Opus 5', tier: 'best', price: '$5 / $25' },
];

const settingsSchema = z.object({
  provider: z.enum(PROVIDERS).catch('builtin'),
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
  geminiApiKey: z.string().catch(''),
  geminiModel: z.string().min(1).catch(DEFAULT_GEMINI_MODEL),
  geminiMaxInputChars: z.number().int().positive().catch(4000),
  /** 「OpenRouter でログイン」で受け取ったキー、または手で貼ったキー */
  openrouterApiKey: z.string().catch(''),
  openrouterModel: z.string().min(1).catch(DEFAULT_OPENROUTER_MODEL),
  openrouterMaxInputChars: z.number().int().positive().catch(4000),
  ollamaUrl: z.string().url().catch(DEFAULT_OLLAMA_URL),
  ollamaModel: z.string().min(1).catch(DEFAULT_OLLAMA_MODEL),
  ollamaMaxInputChars: z.number().int().positive().catch(4000),
  focusOnInvoke: z.boolean().catch(true),
  /** クラウド利用時も解説（2段目）を自動で生成するか。費用が数倍になるので既定はオフ */
  autoExplainCloud: z.boolean().catch(false),
  /** 同じ言語の校正で見つかった客観的な誤りを自動で記録するか（Phase 3） */
  autoSaveMistakes: z.boolean().catch(true),
  /** 改稿を待つ間に復習クイズを1問出すか（Phase 4） */
  quizWhileWaiting: z.boolean().catch(true),
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

/** 続けて変更しても片方が失われないよう、読み込み→書き込みをページをまたいで直列化する */
export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  return withLock(KEY, async () => {
    const next = normalizeSettings({ ...(await loadSettings()), ...patch });
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && KEY in changes) listener(normalizeSettings(changes[KEY].newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
