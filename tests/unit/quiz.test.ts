import { describe, expect, it } from 'vitest';
import { quizChoices } from '../../src/domain/quiz';

describe('quizChoices', () => {
  it('誤った表現と直した表現を並べ、違う箇所と、片方にない箇所（隙間）に印を付ける', () => {
    const [a, b] = quizChoices({ before: 'Heroku, Inc (Salesforce)', after: 'Heroku, Inc. (Salesforce)' }, () => 0);
    expect(a).toMatchObject({ text: 'Heroku, Inc (Salesforce)', correct: false });
    expect(a.parts).toEqual([
      { text: 'Heroku, Inc', mark: 'same' },
      { text: '', mark: 'gap' },
      { text: ' (Salesforce)', mark: 'same' },
    ]);
    expect(b).toMatchObject({ text: 'Heroku, Inc. (Salesforce)', correct: true });
    expect(b.parts).toEqual([
      { text: 'Heroku, Inc', mark: 'same' },
      { text: '.', mark: 'diff' },
      { text: ' (Salesforce)', mark: 'same' },
    ]);
  });

  it('置き換えでは両方の違う箇所に印を付け、隙間の印は出さない', () => {
    const [wrong, right] = quizChoices({ before: 'had went', after: 'went' }, () => 0);
    expect(wrong.parts).toEqual([
      { text: 'had ', mark: 'diff' },
      { text: 'went', mark: 'same' },
    ]);
    expect(right.parts).toEqual([
      { text: '', mark: 'gap' },
      { text: 'went', mark: 'same' },
    ]);
    const [w2] = quizChoices({ before: 'I goed home', after: 'I went home' }, () => 0);
    expect(w2.parts.map((p) => p.mark)).not.toContain('gap');
  });

  it('並び順はランダム', () => {
    expect(quizChoices({ before: 'a', after: 'b' }, () => 0.9)[0].correct).toBe(true);
    expect(quizChoices({ before: 'a', after: 'b' }, () => 0.1)[0].correct).toBe(false);
  });
});
