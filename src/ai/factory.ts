import type { Settings } from '../storage/settings';
import { AnthropicProvider } from './anthropicProvider';
import { BuiltinProvider } from './builtinProvider';
import {
  CompatibleSpec,
  GEMINI_SPEC,
  OPENAI_SPEC,
  OpenAICompatibleProvider,
  OPENROUTER_SPEC,
  ollamaSpec,
} from './openaiProvider';
import type { AIProvider } from './provider';

/** 設定で明示的に選ばれたプロバイダーだけを返す（自動フォールバックはしない） */
export function createProvider(settings: Settings): AIProvider {
  switch (settings.provider) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: settings.anthropicApiKey,
        model: settings.anthropicModel,
        explainModel: settings.anthropicExplainModel,
        effort: settings.anthropicEffort,
        maxInputChars: settings.anthropicMaxInputChars,
      });
    case 'openai':
    case 'gemini':
    case 'openrouter':
    case 'ollama':
      return new OpenAICompatibleProvider(compatibleSpec(settings), compatibleConfig(settings));
    case 'builtin':
      return new BuiltinProvider();
  }
}

/** OpenAI 互換のプロバイダーの接続先（Ollama は設定の URL） */
export function compatibleSpec(settings: Settings): CompatibleSpec {
  switch (settings.provider) {
    case 'gemini':
      return GEMINI_SPEC;
    case 'openrouter':
      return OPENROUTER_SPEC;
    case 'ollama':
      return ollamaSpec(settings.ollamaUrl);
    default:
      return OPENAI_SPEC;
  }
}

function compatibleConfig(settings: Settings) {
  switch (settings.provider) {
    case 'gemini':
      return { apiKey: settings.geminiApiKey, model: settings.geminiModel, maxInputChars: settings.geminiMaxInputChars };
    case 'openrouter':
      return {
        apiKey: settings.openrouterApiKey,
        model: settings.openrouterModel,
        maxInputChars: settings.openrouterMaxInputChars,
      };
    case 'ollama':
      return { apiKey: '', model: settings.ollamaModel, maxInputChars: settings.ollamaMaxInputChars };
    default:
      return { apiKey: settings.openaiApiKey, model: settings.openaiModel, maxInputChars: settings.openaiMaxInputChars };
  }
}
