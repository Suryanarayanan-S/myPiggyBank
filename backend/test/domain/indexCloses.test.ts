import { describe, expect, it } from 'vitest';
import { indexClosesName, readIndexCloses } from '../../src/domain/indexCloses.js';

const FILE = [
  'Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield',
  'Nifty 50,19-10-2026,23150.85,23175.25,22845,22888.95,-257.2,-1.11,285859145,29268.11,19.33,2.81,1.5',
  'Nifty Next 50,19-10-2026,1,1,1,61234.5,0,0,0,0,0,0,0',
].join('\n');

describe('NSE index closes', () => {
  it('reads the day and the closing value of an index', () => {
    const f = readIndexCloses(FILE);
    expect(f.date).toBe('2026-10-19');
    expect(f.close('Nifty 50')).toBe(22_888_950_000);
    expect(f.close('nifty 50')).toBe(22_888_950_000);
    expect(f.close('Nifty Bank')).toBeNull();
  });

  it('refuses anything else, and names a day’s file', () => {
    expect(() => readIndexCloses('<html>no</html>')).toThrow(/NSE/);
    expect(indexClosesName('2026-10-04')).toBe('ind_close_all_04102026.csv');
  });
});
