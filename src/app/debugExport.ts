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
  // 〜ApiKey の項目はすべて、設定済みかどうか（〜ApiKeySet）だけにする（プロバイダーが増えても漏らさない）
  const safeSettings = Object.fromEntries(
    Object.entries(settings).map(([key, value]) =>
      key.endsWith('ApiKey') ? [`${key}Set`, value !== ''] : [key, value],
    ),
  );
  return JSON.stringify(
    {
      kose: env.extensionVersion,
      exportedAt: env.exportedAt.toISOString(),
      userAgent: env.userAgent,
      settings: safeSettings,
      session,
    },
    null,
    2,
  );
}
