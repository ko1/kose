import { describe, expect, it } from 'vitest';
import { quizChoices } from '../../src/domain/quiz';

describe('quizChoices', () => {
  it('誤った表現と直した表現を、ランダムな順に並べる', () => {
    const card = { before: 'Heroku, Inc (Salesforce)', after: 'Heroku, Inc. (Salesforce)' };
    expect(quizChoices(card, () => 0.1)).toEqual([
      { text: 'Heroku, Inc (Salesforce)', correct: false },
      { text: 'Heroku, Inc. (Salesforce)', correct: true },
    ]);
    expect(quizChoices(card, () => 0.9)[0].correct).toBe(true);
  });
});
