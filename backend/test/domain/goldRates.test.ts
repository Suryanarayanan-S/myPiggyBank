import { describe, expect, it } from 'vitest';
import { readGoldApi, readGoldHistory, readIbja } from '../../src/domain/goldRates.js';

const row = (session: string, date: string, g999: string, g916: string) =>
  `<tr> <td class="x" data-label="${session}"><strong>${date}</strong></td> <td class="x" data-label="Gold 999">${g999}</td> <td class="x" data-label="Gold 995">1</td> <td class="x" data-label="Gold 916">${g916}</td> <td data-label="Silver 999">209467 </td> </tr>`;

describe('IBJA daily rates', () => {
  it('reads 24K (999) and 22K (916) per gram, the evening rate when there is one', () => {
    const page = [
      row('AM', '19/10/2026', '146406', '134108'),
      row('AM', '16/10/2026', '146514', '134207'),
      row('PM', '19/10/2026', '145944', '133685'),
    ].join('\n');
    expect(readIbja(page, '2026-10-21')).toEqual([
      { date: '2026-10-16', k24: 14_651_400_000, k22: 13_420_700_000 }, // morning only
      { date: '2026-10-19', k24: 14_594_400_000, k22: 13_368_500_000 }, // evening wins
    ]);
  });

  it('adds today’s rates (shown apart, dated by the chart’s last day) when newer than the table', () => {
    const page = [
      row('PM', '19/10/2026', '145944', '133685'),
      '<span id="lblGold999_AM">144060</span><span id="lblGold999_PM">144105</span>',
      '<span id="lblGold916_AM">131959</span><span id="lblGold916_PM">132000</span>',
      '{&quot;labels&quot;:[&quot;16/10/2026&quot;,&quot;19/10/2026&quot;,&quot;21/10/2026&quot;],&quot;silverRate&quot;:[1,2,3]}',
    ].join('\n');
    expect(readIbja(page, '2026-10-21').at(-1)).toEqual({
      date: '2026-10-21',
      k24: 14_410_500_000,
      k22: 13_200_000_000,
    });
    // on a holiday the chart ends on the table's last day: nothing is dated wrongly
    const holiday = page.replace(',&quot;21/10/2026&quot;', '');
    expect(readIbja(holiday, '2026-10-21').map((r) => r.date)).toEqual(['2026-10-19']);
    // a chart (another metal's) that ends on another day than today: not taken
    expect(readIbja(page, '2026-10-22').map((r) => r.date)).toEqual(['2026-10-19']);
  });

  it('refuses a page without the rates table', () => {
    expect(() => readIbja('<html>maintenance</html>', '2026-10-21')).toThrow(/IBJA/);
    // rows found but none readable: said, not silently empty
    expect(() => readIbja(row('PM', '19/10/2026', 'n/a', 'n/a'), '2026-10-21')).toThrow(/IBJA/);
  });
});

describe('world gold price (USD per ounce)', () => {
  it('reads the price and the day it is for', () => {
    expect(
      readGoldApi(
        '{"currency":"USD","name":"Gold","price":4132.899902,"symbol":"XAU","updatedAt":"2026-10-21T14:39:36Z"}',
      ),
    ).toEqual({ date: '2026-10-21', usd: 4_132_899_902 });
    expect(() => readGoldApi('{"error":"limit"}')).toThrow(/gold price/);
  });
});

describe('IBJA markup variations', () => {
  it('reads other attribute orders, spaces, commas and &nbsp;', () => {
    const page = `<tr>
      <td data-label="PM" class="txt">
        <strong> 19/10/2026 </strong>
      </td>
      <td class="a" data-label="Gold 999" >&nbsp;1,45,944 </td>
      <td data-label="Gold 916">1,33,685</td>
    </tr>`;
    expect(readIbja(page, '2026-10-21')).toEqual([
      { date: '2026-10-19', k24: 14_594_400_000, k22: 13_368_500_000 },
    ]);
  });

  it('takes one session for both purities: evening only when both have one', () => {
    const page = [
      row('AM', '19/10/2026', '146406', '134108'),
      row('PM', '19/10/2026', '150000', ''), // 916 missing in the evening
    ].join('');
    expect(readIbja(page, '2026-10-21')).toEqual([
      { date: '2026-10-19', k24: 14_640_600_000, k22: 13_410_800_000 },
    ]);
  });

  it('does not date yesterday’s rates as today (the morning after a holiday)', () => {
    const page = [
      row('PM', '19/10/2026', '145944', '133685'),
      '<span id="lblGold999_PM">145944</span><span id="lblGold916_PM">133685</span>',
      '{&quot;labels&quot;:[&quot;19/10/2026&quot;,&quot;21/10/2026&quot;]}',
    ].join('');
    expect(readIbja(page, '2026-10-21').map((r) => r.date)).toEqual(['2026-10-19']);
  });
});

describe('the world gold price’s history', () => {
  it('reads dollar prices by day, leaving out other currencies and bad rows', () => {
    const json = JSON.stringify([
      { date: '1258-01-01', price: 0.89, source: 'measuringworth_british (GBP)' },
      { date: '2020-01-01', price: 1560.67, source: 'worldbank' },
      { date: '2025-01-02', price: 2658.9, source: 'yahoo_finance' },
      { date: 'soon', price: 1, source: 'worldbank' },
      { date: '2025-01-03', price: 0, source: 'yahoo_finance' },
    ]);
    expect(readGoldHistory(json)).toEqual([
      { date: '2020-01-01', usd: 1_560_670_000 },
      { date: '2025-01-02', usd: 2_658_900_000 },
    ]);
  });

  it('says so for anything else', () => {
    expect(() => readGoldHistory('<html>')).toThrow(/gold price history/);
  });
});
