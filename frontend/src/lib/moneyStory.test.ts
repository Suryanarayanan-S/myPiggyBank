import { describe, expect, it } from 'vitest';
import { moneyStory, storyMonth, topSpender, type StoryMonth } from './moneyStory';

const names = { essentials: 'Keep Me Alive', fun: 'Make Me Happy', future: 'Make Me Rich' };
const m = (month: string, p: Partial<StoryMonth> = {}): StoryMonth => ({
  month,
  netIncome: 500_000,
  essentials: 200_000,
  fun: 100_000,
  future: 100_000,
  uncategorised: 0,
  unused: 100_000,
  savingsRateBp: 4_000,
  ...p,
});
const empty = (month: string) =>
  m(month, { netIncome: 0, essentials: 0, fun: 0, future: 0, unused: 0, savingsRateBp: null });
// Intl puts a no-break space before the euro sign.
const plain = (t: string) => t.replace(/\u00a0/g, ' ');
const texts = (months: StoryMonth[], top: { name: string; actual: number } | null = null) =>
  moneyStory({ months, top, names, currency: 'EUR' })!.lines.map((l) => plain(l.text));

describe('storyMonth', () => {
  it('is the latest month with anything recorded', () => {
    expect(storyMonth([m('2026-08'), empty('2026-09')])).toBe('2026-08');
    expect(storyMonth([empty('2026-09')])).toBeNull();
  });
});

describe('moneyStory', () => {
  it('tells the month against the usual of the months before', () => {
    const story = moneyStory({
      months: [
        m('2026-06'),
        m('2026-07'),
        m('2026-08', {
          essentials: 180_000,
          fun: 300_000,
          future: 150_000,
          unused: -130_000,
          savingsRateBp: 2_000,
        }),
      ],
      top: { name: 'Holiday', actual: 250_000 },
      names,
      currency: 'EUR',
    })!;
    expect(story.title).toBe('August 2026 in a nutshell');
    expect(story.lines.map((l) => plain(l.text))).toEqual([
      'Keep Me Alive behaved: 1.800,00 €, 10 % less than usual.',
      'Make Me Happy took a holiday: 3.000,00 €, 200 % more than usual.',
      'Make Me Rich had a growth spurt: 1.500,00 €, 50 % more than usual.',
      'Savings rate 20.0 %, down from 40.0 % in July.',
      'Biggest spender: Holiday at 2.500,00 €.',
      '1.300,00 € more went out than came in — the piggy bank felt a draft.',
    ]);
  });

  it('a first month has no usual to compare with', () => {
    expect(texts([m('2026-08')])).toEqual([
      'Keep Me Alive cost 2.000,00 €.',
      'Make Me Happy spent 1.000,00 €.',
      'Make Me Rich grew by 1.000,00 €.',
      'Savings rate 40.0 %.',
      '1.000,00 € left unspent — the piggy bank says thanks.',
    ]);
  });

  it('empty months in between do not count towards the usual', () => {
    const out = texts([m('2026-06'), empty('2026-07'), m('2026-08', { fun: 0, future: 0 })]);
    expect(out).toContain('Make Me Happy stayed home all month.');
    expect(out).toContain('Make Me Rich took the month off.');
    expect(out).toContain('Savings rate 40.0 %, the same as in June.');
  });

  it('describes the in-between moods', () => {
    const out = (fun: number, future: number) =>
      texts([m('2026-07'), m('2026-08', { fun, future })]);
    expect(out(40_000, 100_000)).toContain(
      'Make Me Happy barely left the house: 400,00 €, 60 % less than usual.',
    );
    expect(out(80_000, 50_000)).toContain(
      'Make Me Happy kept it low-key: 800,00 €, 20 % less than usual.',
    );
    expect(out(80_000, 50_000)).toContain(
      'Make Me Rich grew by 500,00 €, a slower month than usual (50 % less).',
    );
    expect(out(105_000, 100_000)).toContain('Make Me Happy had its usual fun: 1.050,00 €.');
    expect(out(105_000, 100_000)).toContain('Make Me Rich grew by 1.000,00 €, steady as usual.');
    expect(out(130_000, 100_000)).toContain(
      'Make Me Happy went out a bit more: 1.300,00 €, 30 % more than usual.',
    );
  });

  it('has nothing to tell without a recorded month', () => {
    expect(moneyStory({ months: [empty('2026-08')], top: null, names, currency: 'EUR' })).toBe(
      null,
    );
  });

  it('counts uncategorised spending and says it is waiting for a category', () => {
    const onlyBank = { ...empty('2026-09'), uncategorised: 5_000, unused: -5_000 };
    expect(storyMonth([m('2026-08'), onlyBank])).toBe('2026-09');
    expect(texts([m('2026-08', { uncategorised: 12_000 })])).toContain(
      '120,00 € still waiting for a category.',
    );
  });

  it('the biggest spender is a real category, never saving or uncategorised', () => {
    expect(
      topSpender([
        { categoryId: null, name: 'Uncategorised', bucket: null, actual: 900 },
        { categoryId: 's', name: 'Stocks', bucket: 'future', actual: 800 },
        { categoryId: 'r', name: 'Rent', bucket: 'essentials', actual: 700 },
      ]),
    ).toEqual({ name: 'Rent', actual: 700 });
    expect(topSpender([])).toBeNull();
  });

  it('says when money had no exchange rate', () => {
    const out = moneyStory({
      months: [m('2026-08')],
      top: null,
      names,
      currency: 'INR',
      unconverted: [{ currency: 'CHF', amount: 5_000 }],
    })!.lines.map((l) => plain(l.text));
    expect(out.at(-1)).toBe('CHF 50.00 had no exchange rate and is left out.');
  });

  it('words a month without essentials, and rounds before choosing the mood', () => {
    expect(texts([m('2026-07'), m('2026-08', { essentials: 0 })])).toContain(
      'Keep Me Alive cost nothing this month.',
    );
    // 10.4 % shows as "10 %": still "around its usual", never "10 % more".
    expect(texts([m('2026-07'), m('2026-08', { essentials: 220_800 })])).toContain(
      'Keep Me Alive behaved: 2.208,00 €, right around its usual.',
    );
  });

  it('only calls the savings rate the same when it shows the same', () => {
    expect(
      texts([m('2026-07', { savingsRateBp: 3_960 }), m('2026-08', { savingsRateBp: 4_050 })]),
    ).toContain('Savings rate 40.5 %, up from 39.6 % in July.');
    expect(
      texts([m('2026-07', { savingsRateBp: 4_049 }), m('2026-08', { savingsRateBp: 4_051 })]),
    ).toContain('Savings rate 40.5 %, the same as in July.');
  });
});
