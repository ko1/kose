import type { LanguageCode, Situation } from './types';

export const LANGUAGE_LABELS: Record<LanguageCode, { name: string; target: string; english: string }> = {
  ja: { name: '日本語', target: 'よい日本語', english: 'Japanese' },
  en: { name: '英語', target: 'よい英語', english: 'English' },
};

export const SITUATION_LABELS: Record<Situation, { name: string; guidance: string }> = {
  casual: {
    name: '日常会話・SNS',
    guidance: 'Natural and friendly. Do not make it stiffer than necessary.',
  },
  business: {
    name: '仕事・メール',
    guidance: 'Polite and clear. Avoid redundant or excessive honorifics.',
  },
  technical: {
    name: '技術的な議論',
    guidance:
      'Technical discussion (e.g. GitHub issues/PRs). Preserve identifiers, API names, code and the precise technical implications exactly.',
  },
  academic: {
    name: '論文・学術文書',
    guidance:
      'Neutral, precise, academic register. Preserve citations and the strength of claims (do not hedge or strengthen assertions).',
  },
  presentation: {
    name: 'プレゼン・講演',
    guidance: 'Natural spoken language that is easy for listeners to follow.',
  },
  formal: {
    name: '公式な文章',
    guidance: 'Formal wording that minimizes the chance of misunderstanding.',
  },
};
