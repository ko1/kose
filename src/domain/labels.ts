import type { LanguageCode, Situation } from './types';

export const LANGUAGE_LABELS: Record<LanguageCode, { name: string; target: string }> = {
  ja: { name: 'Japanese', target: 'good Japanese' },
  en: { name: 'English', target: 'good English' },
};

export const SITUATION_LABELS: Record<Situation, { name: string; guidance: string }> = {
  casual: {
    name: 'Casual / social media',
    guidance: 'Natural and friendly. Do not make it stiffer than necessary.',
  },
  business: {
    name: 'Work / email',
    guidance: 'Polite and clear. Avoid redundant or excessive honorifics.',
  },
  technical: {
    name: 'Technical discussion',
    guidance:
      'Technical discussion (e.g. GitHub issues/PRs). Preserve identifiers, API names, code and the precise technical implications exactly.',
  },
  academic: {
    name: 'Academic writing',
    guidance:
      'Neutral, precise, academic register. Preserve citations and the strength of claims (do not hedge or strengthen assertions).',
  },
  presentation: {
    name: 'Presentation / talk',
    guidance: 'Natural spoken language that is easy for listeners to follow.',
  },
  formal: {
    name: 'Formal document',
    guidance: 'Formal wording that minimizes the chance of misunderstanding.',
  },
};
