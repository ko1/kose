import { beforeEach } from 'vitest';
import { resetBuiltinSessions } from '../src/ai/builtinProvider';
import { createFakeChrome } from './fakeChrome';

// 文言カタログ（src/shared/messages.ts）は読み込み時に UI 言語を見るので、テストの前に英語に固定する
(globalThis as unknown as { chrome: unknown }).chrome = createFakeChrome();

beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = createFakeChrome();
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  resetBuiltinSessions();
});
