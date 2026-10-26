import { describe, expect, it } from 'vitest';
import { byDemat, dematKey, dematWorth, firstDematTakes, hiddenAmong } from './demat';
import type { Holding } from './investments';

const h = (p: Partial<Holding>) =>
  ({
    id: Math.random().toString(),
    archived: false,
    units: '1',
    ownerMemberId: null,
    accountId: null,
    inView: { value: 0, cost: 0 },
    ...p,
  }) as unknown as Holding;

describe('holdings by demat account', () => {
  it('sums each demat, and each person’s holdings outside one, biggest first', () => {
    const rows = byDemat(
      [
        h({ accountId: 'z1', ownerMemberId: 'surya', inView: { value: 600, cost: 400 } }),
        h({ accountId: 'z1', ownerMemberId: 'surya', inView: { value: 200, cost: 100 } }),
        h({ accountId: 'z2', ownerMemberId: 'dayana', inView: { value: 150, cost: 200 } }),
        // in no demat (or an account that is not one): by person
        h({ ownerMemberId: 'appa', inView: { value: 50, cost: 0 } }),
        h({ accountId: 'bank', ownerMemberId: 'appa', inView: { value: 0, cost: 0 } }),
        // sold, archived or without a rate: left out
        h({ accountId: 'z1', units: '0', inView: { value: 0, cost: 0 } }),
        h({ accountId: 'z1', archived: true, inView: { value: 9, cost: 9 } }),
        h({ accountId: 'z1', inView: null }),
      ],
      new Set(['z1', 'z2']),
    );
    expect(rows).toEqual([
      {
        key: 'z1',
        accountId: 'z1',
        ownerMemberId: 'surya',
        cost: 500,
        value: 800,
        gain: 300,
        returnBp: 6000,
        weightBp: 8000,
      },
      {
        key: 'z2',
        accountId: 'z2',
        ownerMemberId: 'dayana',
        cost: 200,
        value: 150,
        gain: -50,
        returnBp: -2500,
        weightBp: 1500,
      },
      {
        key: 'person:appa',
        accountId: null,
        ownerMemberId: 'appa',
        cost: 0,
        value: 50,
        gain: 50,
        // nothing paid (bonus shares): no percentage
        returnBp: null,
        weightBp: 500,
      },
    ]);
  });
});

describe('what a demat account holds', () => {
  it('counts its open holdings in its currency, at their value and cost', () => {
    const list = [
      h({ accountId: 'z', currency: 'INR', value: 800, cost: 500 } as Partial<Holding>),
      // no price yet: no value, its cost still counts
      h({ accountId: 'z', currency: 'INR', value: null, cost: 100 } as Partial<Holding>),
      h({ accountId: 'z', currency: 'INR', units: '0', value: 0, cost: 0 } as Partial<Holding>),
      h({ accountId: 'z', currency: 'INR', archived: true, value: 9, cost: 9 } as Partial<Holding>),
      h({ accountId: 'z', currency: 'USD', value: 7, cost: 7 } as Partial<Holding>),
      h({ accountId: 'other', currency: 'INR', value: 5, cost: 5 } as Partial<Holding>),
    ];
    expect(dematWorth(list, { id: 'z', currency: 'INR' })).toEqual({
      count: 2,
      value: 800,
      cost: 600,
      gain: 300,
      unpriced: 1,
      other: 1,
    });
  });
});

describe('what a first demat takes', () => {
  const accounts = [
    {
      id: 'z',
      type: 'investment' as const,
      archived: false,
      ownerMemberId: 'appa',
      currency: 'INR',
    },
    {
      id: 'old',
      type: 'investment' as const,
      archived: true,
      ownerMemberId: 'surya',
      currency: 'INR',
    },
    {
      id: 'bank',
      type: 'savings' as const,
      archived: false,
      ownerMemberId: 'surya',
      currency: 'INR',
    },
    // a euro broker is not a demat: it does not count as Surya's first
    {
      id: 'eu',
      type: 'investment' as const,
      archived: false,
      ownerMemberId: 'surya',
      currency: 'EUR',
    },
  ];
  const list = [
    h({ ownerMemberId: 'surya', currency: 'INR' } as Partial<Holding>),
    h({ ownerMemberId: 'surya', currency: 'INR', accountId: 'old' } as Partial<Holding>),
    h({ ownerMemberId: 'surya', currency: 'INR', accountId: 'bank' } as Partial<Holding>),
    // sold, archived or in dollars: not counted (the archived one moves along, unshown)
    h({ ownerMemberId: 'surya', currency: 'INR', units: '0' } as Partial<Holding>),
    h({ ownerMemberId: 'surya', currency: 'INR', archived: true } as Partial<Holding>),
    h({ ownerMemberId: 'surya', currency: 'USD' } as Partial<Holding>),
    h({ ownerMemberId: 'appa', currency: 'INR' } as Partial<Holding>),
  ];
  it('counts the person’s open rupee holdings in no open demat', () => {
    expect(firstDematTakes(list, accounts, 'surya')).toBe(3);
  });
  it('takes nothing when the person already has a demat', () => {
    expect(firstDematTakes(list, accounts, 'appa')).toBe(0);
  });
});

describe('the Market filter', () => {
  it('keys a holding by its demat, else by its person', () => {
    const demats = new Set(['z']);
    expect(dematKey({ accountId: 'z', ownerMemberId: 's' }, demats)).toBe('z');
    expect(dematKey({ accountId: 'bank', ownerMemberId: 's' }, demats)).toBe('person:s');
    expect(dematKey({ accountId: null, ownerMemberId: null }, demats)).toBe('person:');
  });
  it('leaves out only listed ones, and never all', () => {
    expect(hiddenAmong(['z', 'gone'], ['z', 'person:a'])).toEqual(['z']);
    expect(hiddenAmong(['z', 'person:a'], ['z', 'person:a'])).toEqual([]);
    expect(hiddenAmong([], ['z'])).toEqual([]);
  });
});

describe('rows to tick off', () => {
  it('lists a demat even when nothing in it has a price yet, or all of it is sold', () => {
    const rows = byDemat(
      [
        h({ accountId: 'z', inView: { value: 100, cost: 50 } }),
        h({ accountId: 'fresh', inView: null }),
        h({ ownerMemberId: 'appa', archived: true, inView: null }),
      ],
      new Set(['z', 'fresh']),
    );
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['z', 100],
      ['fresh', 0],
      ['person:appa', 0],
    ]);
  });
});
