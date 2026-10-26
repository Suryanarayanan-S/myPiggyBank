import { describe, expect, it } from 'vitest';
import { compareCurrencies } from './markets';
import type { Holding } from './investments';

const h = (currency: string, archived = false) => ({ currency, archived }) as Holding;

describe('comparison currencies', () => {
  it('lists the currencies with markets, most holdings first', () => {
    expect(compareCurrencies([h('INR'), h('EUR'), h('EUR'), h('USD'), h('INR', true)])).toEqual([
      'EUR',
      'INR',
    ]);
    expect(compareCurrencies([])).toEqual([]);
  });
});
