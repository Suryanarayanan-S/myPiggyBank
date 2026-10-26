import { describe, expect, it } from 'vitest';
import { byDemat } from './demat';
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
