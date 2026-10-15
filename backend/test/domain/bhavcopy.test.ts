import { describe, expect, it } from 'vitest';
import { bhavcopyName, priceFor, readBhavcopy } from '../../src/domain/bhavcopy.js';

const FILE = [
  'SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER',
  'INFY, EQ, 14-Oct-2026, 1080.00, 1081.00, 1100.00, 1075.00, 1090.10, 1088.90, 1088.00, 1, 1, 1, 1, 1',
  'INFY, BL, 14-Oct-2026, 1080.00, 1081.00, 1100.00, 1075.00, 1090.10, 1050.00, 1088.00, 1, 1, 1, 1, 1',
  'SGBFEB32IV, GB, 14-Oct-2026, 15400, 15400, 15400, 15400, 15400, 15411.53, 15400, 1, 1, 1, 1, 1',
  'PGINVIT, IV, 14-Oct-2026, 103, 103, 104, 103, 103.84, 103.84, 103, 1, 1, 1, 1, 1',
  'ARE&M, EQ, 14-Oct-2026, 740, 740, 745, 735, 740.4, 740.40, 740, 1, 1, 1, 1, 1',
  'ODD, EQ, 14-Oct-2026, 1, 1, 1, 1, 1, -, 1, 1, 1, 1, 1, 1',
].join('\n');

describe('NSE end-of-day file', () => {
  it('reads the trading day and each instrument’s closing price', () => {
    const b = readBhavcopy(FILE);
    expect(b.date).toBe('2026-10-14');
    expect(priceFor(b, 'INFY')).toBe(1_088_900_000); // the regular market (EQ), not a block deal
    expect(priceFor(b, 'ARE&M')).toBe(740_400_000);
    expect(priceFor(b, 'ODD')).toBeNull(); // no close
    expect(priceFor(b, 'TCS')).toBeNull();
  });

  it('finds Zerodha symbols that carry the series', () => {
    const b = readBhavcopy(FILE);
    expect(priceFor(b, 'SGBFEB32IV-GB')).toBe(15_411_530_000);
    expect(priceFor(b, 'PGINVIT-IV')).toBe(103_840_000);
    expect(priceFor(b, 'SGBFEB32IV')).toBe(15_411_530_000);
  });

  it('skips broken lines instead of failing the whole file', () => {
    const b = readBhavcopy(`${FILE}\nGARBAGE\n`);
    expect(priceFor(b, 'INFY')).toBe(1_088_900_000);
  });

  it('refuses anything that is not the file', () => {
    expect(() => readBhavcopy('<html>Access denied</html>')).toThrow(/NSE/);
    expect(() => readBhavcopy(FILE.split('\n')[0]!)).toThrow(/NSE/);
  });

  it('names the file of a day', () => {
    expect(bhavcopyName('2026-10-04')).toBe('sec_bhavdata_full_04102026.csv');
  });
});
