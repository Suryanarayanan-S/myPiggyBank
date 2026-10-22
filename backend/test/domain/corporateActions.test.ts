import { describe, expect, it } from 'vitest';
import { prName, readCorporateActions } from '../../src/domain/corporateActions.js';

// Lines as NSE writes them in its daily bc file (Oct 2026).
const FILE = [
  'SERIES,SYMBOL,SECURITY,RECORD_DT,BC_STRT_DT,BC_END_DT,EX_DT,ND_STRT_DT,ND_END_DT,PURPOSE',
  'Z4,1003SCFL31,SEC RE NCD 10.03% SR X,2026-10-09,,,2026-10-09,,,INTEREST PAYMENT',
  'BE,BUILDPRO,Shankara Buildpro Limited,2026-10-08,,,2026-10-08,,,FVSPLT FRM RS 10 TO RS 2',
  'EQ,BUILDPRO,Shankara Buildpro Limited,2026-10-08,,,2026-10-08,,,FVSPLT FRM RS 10 TO RS 2',
  'EQ,JSWDULUX,JSW Dulux Ltd,2026-10-22,,,2026-10-22,,,FV SPLT FRM RS10 TO RE1',
  'EQ,MOLDTECH,Mold-Tek Technologies Ltd,2026-10-09,,,2026-10-09,,,BONUS 1:1',
  'EQ,ABC,ABC Ltd,2026-10-12,,,2026-10-12,,,BONUS 2:3',
  'EQ,XYZ,XYZ Ltd,2026-10-12,,,2026-10-12,,,CONSOLIDATION FRM RS 1 TO RS 10',
  'EQ,HALF,Half Ltd,2026-10-12,,,2026-10-12,,,FV SPLIT FROM RS 5 TO RS 2.50',
  'EQ,BHAGYANGR,Bhagyanagar India Ltd,2026-10-08,,,2026-10-08,,,DEMERGER',
  'EQ,RIGHTCO,Right Co,2026-10-13,,,2026-10-13,,,RIGHTS 1:5 @ PREMIUM RS 90/-',
  'EQ,ODDSPLIT,Odd,2026-10-13,,,2026-10-13,,,FV SPLIT',
  'EQ,HOSP,"Hospital Co, Ltd",2026-10-13,,,2026-10-13,,,HOSPITALITY DIVISION MEET',
  'EQ,QUOTED,"Quoted, Name Ltd",2026-10-14,,,2026-10-14,,,BONUS 1:2',
  'EQ,HINDCOMPOS,Hindustan Composites,2026-10-16,,,2026-10-16,,,SPLDIV - RS 21 PER SH',
  'EQ,INFY,Infosys,2026-10-24,,,2026-10-24,,,INTERIM DIVIDEND - RS 23 PER SHARE',
  'EQ,BROKEN,No date,2026-10-24,,,,,,BONUS 1:1',
].join('\n');

describe('NSE corporate actions (bc file)', () => {
  it('names the daily PR zip', () => {
    expect(prName('2026-10-08')).toBe('PR081026.zip');
  });

  it('reads splits, bonus issues and consolidations with their factor; others to check', () => {
    expect(readCorporateActions(FILE)).toEqual([
      {
        symbol: 'BUILDPRO',
        exDate: '2026-10-08',
        purpose: 'FVSPLT FRM RS 10 TO RS 2',
        kind: 'split',
        num: 5,
        den: 1,
      },
      {
        symbol: 'JSWDULUX',
        exDate: '2026-10-22',
        purpose: 'FV SPLT FRM RS10 TO RE1',
        kind: 'split',
        num: 10,
        den: 1,
      },
      {
        symbol: 'MOLDTECH',
        exDate: '2026-10-09',
        purpose: 'BONUS 1:1',
        kind: 'bonus',
        num: 2,
        den: 1,
      },
      // 2 new shares for every 3 held: 3 → 5
      { symbol: 'ABC', exDate: '2026-10-12', purpose: 'BONUS 2:3', kind: 'bonus', num: 5, den: 3 },
      {
        symbol: 'XYZ',
        exDate: '2026-10-12',
        purpose: 'CONSOLIDATION FRM RS 1 TO RS 10',
        kind: 'consolidation',
        num: 1,
        den: 10,
      },
      {
        symbol: 'HALF',
        exDate: '2026-10-12',
        purpose: 'FV SPLIT FROM RS 5 TO RS 2.50',
        kind: 'split',
        num: 2,
        den: 1,
      },
      // cannot be adjusted by a factor: the user checks units and cost
      {
        symbol: 'BHAGYANGR',
        exDate: '2026-10-08',
        purpose: 'DEMERGER',
        kind: 'review',
        num: null,
        den: null,
      },
      {
        symbol: 'RIGHTCO',
        exDate: '2026-10-13',
        purpose: 'RIGHTS 1:5 @ PREMIUM RS 90/-',
        kind: 'review',
        num: null,
        den: null,
      },
      {
        symbol: 'ODDSPLIT',
        exDate: '2026-10-13',
        purpose: 'FV SPLIT',
        kind: 'review',
        num: null,
        den: null,
      },
      // a comma inside a quoted name does not shift the columns; HOSPITALITY is no split
      {
        symbol: 'QUOTED',
        exDate: '2026-10-14',
        purpose: 'BONUS 1:2',
        kind: 'bonus',
        num: 3,
        den: 2,
      },
    ]);
  });

  it('says so when the file is not the list', () => {
    expect(() => readCorporateActions('<html>busy</html>')).toThrow(/corporate actions/);
  });

  it('reads the older lists too (dd/mm/yyyy, padded purposes)', () => {
    const old = [
      'SERIES,SYMBOL,SECURITY,RECORD_DT,BC_STRT_DT,BC_END_DT,EX_DT,ND_STRT_DT,ND_END_DT,PURPOSE',
      'EQ,HDFCBANK,HDFC Bank Limited,27/08/2025, , ,26/08/2025, , ,BONUS 1:1                ',
    ].join('\n');
    expect(readCorporateActions(old)).toEqual([
      {
        symbol: 'HDFCBANK',
        exDate: '2025-08-26',
        purpose: 'BONUS 1:1',
        kind: 'bonus',
        num: 2,
        den: 1,
      },
    ]);
  });
});
