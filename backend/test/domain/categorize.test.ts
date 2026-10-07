import { describe, expect, it } from 'vitest';
import { suggestCategory } from '../../src/domain/categorize.js';

type B = 'essentials' | 'fun' | 'future' | null;
const c = (id: string, name: string, kind: 'income' | 'expense', bucket: B) => ({ id, name, kind, bucket });
const cats = [
  c('salary', 'Salary', 'income', null),
  c('other-inc', 'Other income', 'income', null),
  c('refund', 'Tax refund', 'income', null),
  c('rent', 'Rent', 'expense', 'essentials'),
  c('groceries', 'Groceries', 'expense', 'essentials'),
  c('transport', 'Transportation', 'expense', 'essentials'),
  c('phone', 'Phone', 'expense', 'essentials'),
  c('internet', 'Internet', 'expense', 'essentials'),
  c('insurance', 'Insurance', 'expense', 'essentials'),
  c('restaurants', 'Restaurants', 'expense', 'fun'),
  c('subs', 'Subscriptions', 'expense', 'fun'),
  c('travel', 'Travel', 'expense', 'fun'),
  c('rd', 'Recurring deposit', 'expense', 'future'),
  c('stocks', 'Stocks', 'expense', 'future'),
  c('etf', 'ETF & Gold', 'expense', 'future'),
  c('scheme', 'Savings scheme', 'expense', 'future'),
];
const s = (label: string, kind: 'income' | 'expense', bucket: B) => suggestCategory(label, kind, bucket, cats);

describe('suggestCategory', () => {
  it('matches an existing category name exactly, ignoring case and spaces', () => {
    expect(s('  rent ', 'expense', 'essentials')).toEqual({ categoryId: 'rent' });
    expect(s('SALARY', 'income', null)).toEqual({ categoryId: 'salary' });
  });

  it.each([
    ['Phone bill', 'essentials', 'phone'],
    ['wifi', 'essentials', 'internet'],
    ['Train TIcket', 'essentials', 'transport'],
    ['Icici Insurance', 'essentials', 'insurance'],
    ['Restaurant', 'fun', 'restaurants'],
    ['hotel', 'fun', 'restaurants'],
    ['Netflix', 'fun', 'subs'],
    ['Amazon prime', 'fun', 'subs'],
    ['Flight Ticket', 'fun', 'travel'],
    ['India trip', 'fun', 'travel'],
    ['SBI & Icici RD', 'future', 'rd'],
    ['Germany Stocks', 'future', 'stocks'],
    ['Stocks & Gold ETF', 'future', 'etf'],
    ['GRT', 'future', 'scheme'],
  ] as const)('maps %j in %s to %s', (label, bucket, id) => {
    expect(s(label, 'expense', bucket)).toEqual({ categoryId: id });
  });

  it('only suggests categories in the same bucket', () => {
    // "LIC Insurance" sits under Future You: never the Essentials "Insurance" category.
    expect(s('LIC Insurance', 'expense', 'future')).toEqual({ categoryId: 'scheme' });
    expect(s('Car insurance', 'expense', 'fun')).toEqual({ newName: 'Other fun' });
  });

  it("collects one-off labels in the bucket's catch-all category instead of creating one per label", () => {
    expect(s('Perima', 'expense', 'fun')).toEqual({ newName: 'Other fun' });
    expect(s('marriage expense', 'expense', 'fun')).toEqual({ newName: 'Other fun' });
    expect(s('Dayana', 'expense', 'essentials')).toEqual({ newName: 'Other essentials' });
    expect(s('Land Loan', 'expense', 'future')).toEqual({ newName: 'Other savings' });
  });

  it('uses an existing catch-all category when the family already has one', () => {
    const withOther = [...cats, c('other-fun', 'Other fun', 'expense', 'fun')];
    expect(suggestCategory('Perima', 'expense', 'fun', withOther)).toEqual({ categoryId: 'other-fun' });
  });

  it('suggests a new category when the keyword target does not exist in the family', () => {
    expect(s('Electricity', 'expense', 'essentials')).toEqual({ newName: 'Electricity' });
  });

  it('maps income labels', () => {
    expect(s('Tax', 'income', null)).toEqual({ categoryId: 'refund' });
    expect(s('Freelancing', 'income', null)).toEqual({ categoryId: 'other-inc' });
    expect(s('Other Income', 'income', null)).toEqual({ categoryId: 'other-inc' });
    expect(s('5', 'income', null)).toEqual({ categoryId: 'other-inc' });
  });
});
