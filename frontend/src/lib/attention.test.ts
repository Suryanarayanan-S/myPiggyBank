import { describe, expect, it } from 'vitest';
import { attentionItems } from './attention';
import type { Holding, HoldingAction } from './investments';

const holding = (name: string, p: Partial<Holding> = {}) =>
  ({
    id: name,
    name,
    symbol: name,
    currency: 'INR',
    archived: false,
    units: '10',
    price: '100',
    priceDate: '2026-10-27',
    actions: [],
    ...p,
  }) as unknown as Holding;
const review: HoldingAction = {
  exDate: '2026-10-25',
  purpose: 'Price adjustment ×1.0407 (onvista)',
  kind: 'review',
  status: 'review',
  unitsBefore: '3',
  unitsAfter: '3',
};
const base = { today: '2026-10-28', uncategorised: null, holdings: [], pricesOn: true };

describe('attentionItems', () => {
  it('nothing to look at: an empty list', () => {
    expect(attentionItems(base)).toEqual([]);
    expect(attentionItems({ ...base, uncategorised: { count: 0, latestMonth: null } })).toEqual([]);
  });

  it('names what to sort out, each with where to do it', () => {
    const items = attentionItems({
      ...base,
      uncategorised: { count: 3, latestMonth: '2026-08' },
      holdings: [
        holding('Sony Group', { symbol: 'JP3435000009', currency: 'EUR', actions: [review] }),
        holding('NATCO-RE', { price: null, priceDate: null }),
        holding('SCTL', { price: null, priceDate: null }),
        holding('OLD', { price: null, archived: true }), // archived: not asked about
        holding('SOLD', { price: null, units: '0' }), // nothing held: no price needed
      ],
    });
    expect(items.map((i) => [i.text, i.link])).toEqual([
      [
        '3 payments or income without a category',
        '/spending/transactions?categoryId=none&month=2026-08',
      ],
      ['1 new corporate action to check: Sony Group', '/investments/market'],
      ['No price yet: NATCO-RE, SCTL', '/investments/market?tab=holdings'],
    ]);
  });

  it('a corporate action is new for a week (the Investments page keeps listing it)', () => {
    const old = { ...review, exDate: '2026-10-20' };
    expect(attentionItems({ ...base, holdings: [holding('X', { actions: [old] })] })).toEqual([]);
  });

  it('long lists are cut short', () => {
    const many = 'ABCDEFG'.split('').map((n) => holding(n, { price: null, priceDate: null }));
    expect(attentionItems({ ...base, holdings: many })[0]!.text).toBe(
      'No price yet: A, B, C, D, E and 2 more',
    );
  });

  it('daily prices that stopped coming, per currency held, only with daily prices on', () => {
    const holdings = [
      holding('INFY', { priceDate: '2026-10-27' }),
      holding('Toyota', { currency: 'EUR', priceDate: '2026-10-16' }),
    ];
    expect(attentionItems({ ...base, holdings }).map((i) => i.text)).toEqual([
      'Prices of your EUR holdings last updated 16 Oct',
    ]);
    expect(attentionItems({ ...base, holdings, pricesOn: false })).toEqual([]);
  });
});
