import { describe, expect, it } from 'vitest';
import { accountLabeler } from './accountLabel';

describe('account labels', () => {
  it('adds the owner only where a name is shared', () => {
    const label = accountLabeler(
      [
        { id: '1', name: 'Zerodha', ownerMemberId: 's' },
        { id: '2', name: 'zerodha', ownerMemberId: 'a' },
        { id: '3', name: 'Zerodha', ownerMemberId: null },
        { id: '4', name: 'ICICI', ownerMemberId: 's' },
      ],
      [
        { id: 's', name: 'Surya' },
        { id: 'a', name: 'Appa' },
      ],
    );
    expect(label({ name: 'Zerodha', ownerMemberId: 's' })).toBe('Zerodha · Surya');
    expect(label({ name: 'zerodha', ownerMemberId: 'a' })).toBe('zerodha · Appa');
    expect(label({ name: 'Zerodha', ownerMemberId: null })).toBe('Zerodha · Shared');
    expect(label({ name: 'ICICI', ownerMemberId: 's' })).toBe('ICICI');
  });
});
