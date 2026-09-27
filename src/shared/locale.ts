/** The browser UI language as a primary subtag (e.g. "ja", "en"). AI explanations are written in it. */
export function uiLanguage(): string {
  const g = globalThis as { chrome?: { i18n?: { getUILanguage?: () => string } }; navigator?: { language?: string } };
  const tag = g.chrome?.i18n?.getUILanguage?.() ?? g.navigator?.language ?? 'en';
  return tag.split(/[-_]/)[0].toLowerCase() || 'en';
}

/** The English name of a language code, for prompts (e.g. "ja" → "Japanese") */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? 'English';
  } catch {
    return 'English';
  }
}
