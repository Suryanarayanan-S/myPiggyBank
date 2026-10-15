import { describe, expect, it } from 'vitest';
import { INDEX_LISTS, classify, readIndexList } from '../../src/domain/indexLists.js';

const list = (...rows: string[]) =>
  ['Company Name,Industry,Symbol,Series,ISIN Code', ...rows].join('\n');

describe('NSE index lists', () => {
  it('reads symbol and industry, also with quoted names', () => {
    expect(
      readIndexList(
        list(
          'Infosys Ltd.,Information Technology,INFY,EQ,INE009A01021',
          '"Mahindra & Mahindra, Ltd.",Automobile and Auto Components,M&M,EQ,INE101A01026',
        ),
      ),
    ).toEqual([
      { symbol: 'INFY', industry: 'Information Technology' },
      { symbol: 'M&M', industry: 'Automobile and Auto Components' },
    ]);
    expect(() => readIndexList('<html>blocked</html>')).toThrow(/NSE/);
  });

  it('gives each symbol its industry and SEBI size group (beyond the top 250 is small)', () => {
    const files = {
      nifty500: [
        { symbol: 'INFY', industry: 'IT' },
        { symbol: 'BHEL', industry: 'Capital Goods' },
      ],
      nifty100: [{ symbol: 'INFY', industry: 'IT' }],
      midcap150: [{ symbol: 'BHEL', industry: 'Capital Goods' }],
      smallcap250: [{ symbol: 'IEX', industry: 'Financial Services' }],
      microcap250: [{ symbol: 'GLOBE', industry: 'Textiles' }],
    };
    expect(classify(files)).toEqual([
      { symbol: 'INFY', industry: 'IT', cap: 'large' },
      { symbol: 'BHEL', industry: 'Capital Goods', cap: 'mid' },
      { symbol: 'IEX', industry: 'Financial Services', cap: 'small' },
      { symbol: 'GLOBE', industry: 'Textiles', cap: 'small' },
    ]);
    expect(Object.keys(INDEX_LISTS)).toEqual(Object.keys(files));
  });
});
