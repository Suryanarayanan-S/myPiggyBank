import { describe, expect, it } from 'vitest';
import { categorizePrompt, readCategorizeAnswer } from '../../src/domain/aiCategorize.js';

const categories = [
  { id: 'id-groc', name: 'Groceries', kind: 'expense', bucket: 'essentials' },
  { id: 'id-rest', name: 'Restaurants', kind: 'expense', bucket: 'fun' },
  { id: 'id-sal', name: 'Salary', kind: 'income', bucket: null },
] as const;
const names = { essentials: 'Keep Me Alive', fun: 'Make Me Happy', future: 'Make Me Rich' };
const lines = [
  { text: 'Bäckerei Schäfer DE89370400440532013000', type: 'expense', amount: 480 },
  { text: 'Employer GmbH', type: 'income', amount: 375000 },
] as const;

describe('categorizePrompt', () => {
  it('sends short keys, bucket names, the amounts and the masked text — no ids', () => {
    const { prompt } = categorizePrompt([...lines], [...categories], names, 'EUR');
    const sent = JSON.parse(prompt.slice(prompt.indexOf('{')));
    expect(sent.currency).toBe('EUR');
    expect(sent.categories).toEqual([
      { key: 'c1', name: 'Groceries', kind: 'expense', bucket: 'Keep Me Alive (needs)' },
      { key: 'c2', name: 'Restaurants', kind: 'expense', bucket: 'Make Me Happy (wants)' },
      { key: 'c3', name: 'Salary', kind: 'income' },
    ]);
    expect(sent.lines).toEqual([
      { line: 1, type: 'expense', amount: '4.80', text: 'Bäckerei Schäfer [IBAN]' },
      { line: 2, type: 'income', amount: '3750.00', text: 'Employer GmbH' },
    ]);
    expect(prompt).not.toContain('id-groc');
  });
});

describe('readCategorizeAnswer', () => {
  const { keys } = categorizePrompt([...lines], [...categories], names, 'EUR');
  const read = (answers: { line: number; category: string | null }[]) =>
    readCategorizeAnswer({ answers }, [...lines], [...categories], keys);

  it('maps keys back to categories, one per line', () => {
    expect(
      read([
        { line: 1, category: 'c1' },
        { line: 2, category: 'c3' },
      ]),
    ).toEqual(['id-groc', 'id-sal']);
  });

  it('drops unknown keys, the wrong kind, unknown lines and leaves unsure lines empty', () => {
    expect(
      read([
        { line: 1, category: 'c3' }, // income category for a payment
        { line: 2, category: 'c99' },
        { line: 7, category: 'c1' },
      ]),
    ).toEqual([null, null]);
    expect(read([{ line: 1, category: null }])).toEqual([null, null]);
    // the first answer for a line counts
    expect(
      read([
        { line: 1, category: 'c2' },
        { line: 1, category: 'c1' },
      ]),
    ).toEqual(['id-rest', null]);
  });
});
