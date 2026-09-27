import type { ReviewSession } from '../domain/types';
import type { Settings } from '../storage/settings';

/**
 * 表示中のレビューをデバッグ用のJSONにする。ユーザーが明示的にコピーするときだけ使う。
 * APIキーは含めない。
 */
export function buildDebugExport(
  session: ReviewSession,
  settings: Settings,
  env: { extensionVersion: string; userAgent: string; exportedAt: Date },
): string {
  const { openaiApiKey, anthropicApiKey, ...safeSettings } = settings;
  return JSON.stringify(
    {
      kose: env.extensionVersion,
      exportedAt: env.exportedAt.toISOString(),
      userAgent: env.userAgent,
      settings: {
        ...safeSettings,
        openaiApiKeySet: openaiApiKey !== '',
        anthropicApiKeySet: anthropicApiKey !== '',
      },
      session,
    },
    null,
    2,
  );
}
