import { beforeEach } from 'vitest';
import { resetBuiltinSessions } from '../src/ai/builtinProvider';
import { createFakeChrome } from './fakeChrome';

beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = createFakeChrome();
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  resetBuiltinSessions();
});
