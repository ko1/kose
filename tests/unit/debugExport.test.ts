import { describe, expect, it } from 'vitest';
import { buildDebugExport } from '../../src/app/debugExport';
import { addVersion, createSession } from '../../src/domain/session';
import { DEFAULT_SETTINGS } from '../../src/storage/settings';

describe('buildDebugExport', () => {
  it('セッション全体と設定を含み、APIキーは含めない', () => {
    let session = createSession(
      {
        requestId: 'r1',
        targetLanguage: 'en',
        text: 'I has a pen.',
        source: { tabId: 1, frameId: 0, textSource: 'script', editable: false },
        createdAt: 1,
      },
      'casual',
    );
    session = addVersion(
      session,
      { revisedText: 'I have a pen.', detectedSourceLanguage: 'en' },
      { targetLanguage: 'en', situation: 'casual' },
      2,
      { provider: 'builtin', durationMs: 1234 },
    );
    const json = buildDebugExport(
      session,
      { ...DEFAULT_SETTINGS, openaiApiKey: 'sk-secret', anthropicApiKey: 'sk-ant-secret' },
      { extensionVersion: '0.1.0', userAgent: 'UA', exportedAt: new Date(0) },
    );
    expect(json).not.toContain('sk-secret');
    expect(json).not.toContain('sk-ant-secret');
    const parsed = JSON.parse(json);
    expect(parsed.settings.openaiApiKeySet).toBe(true);
    expect(parsed.session.sourceText).toBe('I has a pen.');
    expect(parsed.session.versions[0]).toMatchObject({ provider: 'builtin', durationMs: 1234 });
  });
});
