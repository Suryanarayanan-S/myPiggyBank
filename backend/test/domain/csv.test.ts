import { describe, expect, it } from 'vitest';
import {
  decodeText,
  guessMapping,
  parseBankAmount,
  parseBankDate,
  parseCsv,
} from '../../src/domain/csv.js';
import { sparkasseCsv } from '../fixtures/bankCsv.js';

describe('decodeText', () => {
  it('decodes Windows-1252 bank exports (umlauts) when the bytes are not UTF-8', () => {
    expect(decodeText(Buffer.from('Bäckerei Müller', 'latin1'))).toBe('Bäckerei Müller');
  });
  it('decodes UTF-8 and strips a BOM', () => {
    expect(
      decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Bäckerei', 'utf8')])),
    ).toBe('Bäckerei');
  });
});

describe('parseCsv', () => {
  it('reads a Sparkasse export: semicolons, quotes, a ";" inside quotes, CRLF, trailing newline', () => {
    const { delimiter, rows } = parseCsv(decodeText(sparkasseCsv()));
    expect(delimiter).toBe(';');
    expect(rows).toHaveLength(6);
    expect(rows[0]![1]).toBe('Buchungstag');
    expect(rows[2]![4]).toBe('REWE Markt; Filiale 123');
    expect(rows[5]![5]).toBe('Bäckerei');
  });
  it('reads comma CSV with doubled quotes and newlines inside quotes', () => {
    const { delimiter, rows } = parseCsv(
      'Date,Description,Amount\n2026-10-02,"Say ""hi""\nthere","1,234.56"\n',
    );
    expect(delimiter).toBe(',');
    expect(rows[1]).toEqual(['2026-10-02', 'Say "hi"\nthere', '1,234.56']);
  });
  it('reads tab-separated files', () => {
    expect(parseCsv('a\tb\n1\t2').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('guessMapping', () => {
  it('recognises German and English column names', () => {
    const [header] = parseCsv(decodeText(sparkasseCsv())).rows;
    expect(guessMapping(header!)).toEqual({
      date: 1,
      description: 4,
      payee: 5,
      amount: 8,
      currency: 9,
    });
    expect(guessMapping(['Date', 'Payee', 'Amount'])).toEqual({
      date: 0,
      description: null,
      payee: 1,
      amount: 2,
      currency: null,
    });
  });
});

describe('parseBankDate', () => {
  it.each([
    ['01.10.26', 'dd.mm.yyyy', '2026-10-01'],
    ['01.10.2026', 'dd.mm.yyyy', '2026-10-01'],
    ['01/10/2026', 'dd/mm/yyyy', '2026-10-01'],
    ['10/01/2026', 'mm/dd/yyyy', '2026-10-01'],
    ['2026-10-01', 'yyyy-mm-dd', '2026-10-01'],
  ] as const)('%s (%s)', (s, f, out) => expect(parseBankDate(s, f)).toBe(out));
  it('rejects impossible dates', () => {
    expect(parseBankDate('31.02.2026', 'dd.mm.yyyy')).toBeNull();
    expect(parseBankDate('hello', 'dd.mm.yyyy')).toBeNull();
  });
});

describe('parseBankAmount', () => {
  it.each([
    ['-52,40', ',', -5240],
    ['3.750,00', ',', 375000],
    ['1,234.56', '.', 123456],
    ['-1234.5', '.', -123450],
    ['+12', ',', 1200],
    ['52,40 €', ',', 5240],
  ] as const)('%s', (s, d, out) => expect(parseBankAmount(s, d)).toBe(out));
  it('rejects garbage', () => {
    expect(parseBankAmount('', ',')).toBeNull();
    expect(parseBankAmount('abc', ',')).toBeNull();
  });
});
