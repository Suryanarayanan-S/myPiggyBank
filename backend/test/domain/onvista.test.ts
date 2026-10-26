import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readEod, readSearch, readSnapshot, splitRatio } from '../../src/domain/onvista.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

describe('onvista', () => {
  it('finds the instrument of an ISIN', () => {
    expect(readSearch(fixture('onvista-search.json'), 'JP3633400001')).toEqual({
      entityType: 'STOCK',
      entityValue: '85671',
      name: 'Toyota',
    });
    expect(readSearch(fixture('onvista-search.json'), 'US0000000000')).toBeNull();
    expect(readSearch('{"facets":null}', 'X')).toBeNull();
  });

  it('picks a venue quoted in the currency (Tradegate first) and reads the splits', () => {
    const s = readSnapshot(fixture('onvista-snapshot.json'), 'EUR');
    expect(s.quote).toEqual({ idNotation: '9385956', venue: 'Tradegate BSX', currency: 'EUR' });
    expect(s.splits).toEqual([{ date: '2021-09-29', factor: 5 }]);
    // no venue in that currency
    expect(readSnapshot(fixture('onvista-snapshot.json'), 'CHF').quote).toBeNull();
  });

  it('reads daily closes (the day of each timestamp)', () => {
    const eod = JSON.stringify({
      isoCurrency: 'EUR',
      datetimeLast: [1577966400, 1578052800],
      last: [12.76, 12.645],
    });
    expect(readEod(eod)).toEqual([
      { date: '2020-01-02', close: 12_760_000 },
      { date: '2020-01-03', close: 12_645_000 },
    ]);
    expect(readEod('{}')).toEqual([]);
  });

  it('turns a split factor into whole units before and after', () => {
    expect(splitRatio(5)).toEqual({ num: 5, den: 1 });
    expect(splitRatio(1.5)).toEqual({ num: 3, den: 2 });
    expect(splitRatio(0.1)).toEqual({ num: 1, den: 10 });
    // as onvista lists Honda's 1:3 split of 2023
    expect(splitRatio(3.000003)).toEqual({ num: 3, den: 1 });
    // Sony's spin-off price adjustment of 2025: not a split
    expect(splitRatio(1.04072243)).toBeNull();
    // adjustments that happen to sit near a ratio are not splits either
    expect(splitRatio(1.05)).toBeNull();
    expect(splitRatio(1.1)).toBeNull();
    expect(splitRatio(1)).toBeNull();
    expect(splitRatio(0)).toBeNull();
  });
});
