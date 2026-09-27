import type { Settings } from '../storage/settings';
import { AnthropicProvider } from './anthropicProvider';
import { BuiltinProvider } from './builtinProvider';
import { OpenAIProvider } from './openaiProvider';
import type { AIProvider } from './provider';

/** 設定で明示的に選ばれたプロバイダーだけを返す（自動フォールバックはしない） */
export function createProvider(settings: Settings): AIProvider {
  if (settings.provider === 'openai') {
    return new OpenAIProvider({
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel,
      maxInputChars: settings.openaiMaxInputChars,
    });
  }
  if (settings.provider === 'anthropic') {
    return new AnthropicProvider({
      apiKey: settings.anthropicApiKey,
      model: settings.anthropicModel,
      explainModel: settings.anthropicExplainModel,
      effort: settings.anthropicEffort,
      maxInputChars: settings.anthropicMaxInputChars,
    });
  }
  return new BuiltinProvider();
}
