import { describe, expect, it } from 'vitest';
import { computeBalances, type BalanceTxn } from '../../src/domain/balances.js';

const t = (p: Partial<BalanceTxn>): BalanceTxn => ({
  accountId: 'a',
  type: 'expense',
  amount: 0,
  transferAccountId: null,
  transferAmount: null,
  ...p,
});

describe('computeBalances', () => {
  const accounts = [
    { id: 'a', openingBalance: 100_000 },
    { id: 'b', openingBalance: 0 },
  ];

  it('starts from the opening balance and applies income and expenses', () => {
    const b = computeBalances(accounts, [
      t({ type: 'income', amount: 541_600 }),
      t({ type: 'expense', amount: 5_240 }),
    ]);
    expect(b.get('a')).toBe(636_360);
    expect(b.get('b')).toBe(0);
  });

  it('moves a same-currency transfer from source to destination', () => {
    const b = computeBalances(accounts, [
      t({ type: 'transfer', amount: 20_000, transferAccountId: 'b' }),
    ]);
    expect(b.get('a')).toBe(80_000);
    expect(b.get('b')).toBe(20_000);
  });

  it('credits the destination with transferAmount for cross-currency transfers', () => {
    const b = computeBalances(accounts, [
      t({ type: 'transfer', amount: 10_000, transferAccountId: 'b', transferAmount: 978_500 }),
    ]);
    expect(b.get('a')).toBe(90_000);
    expect(b.get('b')).toBe(978_500);
  });

  it('ignores transactions for unknown accounts', () => {
    const b = computeBalances(accounts, [t({ accountId: 'zzz', type: 'income', amount: 5 })]);
    expect([...b.values()]).toEqual([100_000, 0]);
  });
});
