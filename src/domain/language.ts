import type { DetectedLanguage } from './types';

/**
 * 原文が日本語か英語かを文字の種類から判定する（AIの申告に頼らない）。
 * 文字数ではなくおおよその語数で比べる（日本語は約2文字、英語は約4.5文字で1語）。
 * URLは言語の手がかりにならないので除く。
 */
export function detectLanguage(text: string): DetectedLanguage {
  const body = text.replace(/https?:\/\/\S+/g, ' ');
  const ja = (body.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu)?.length ?? 0) / 2;
  const en = (body.match(/\p{Script=Latin}/gu)?.length ?? 0) / 4.5;
  if (ja + en < 1) return 'unknown';
  const jaShare = ja / (ja + en);
  if (jaShare >= 0.5) return 'ja';
  if (jaShare <= 0.1) return 'en';
  return 'mixed';
}
