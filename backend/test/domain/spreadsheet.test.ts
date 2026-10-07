import { describe, expect, it } from 'vitest';
import { parseSheetMonth, parseSpendingWorkbook } from '../../src/domain/spreadsheet.js';
import JSZip from 'jszip';
import { buildWorkbook } from '../fixtures/workbook.js';

const september = {
  name: 'Sep 26',
  income: [
    ['Salary', 3750],
    ['Other Income', null],
    ['Tax', 2000],
  ] as [string, number | null][],
  essentials: [
    ['Rent', 912],
    ['Phone bill', 20],
    ['Icici Insurance', 58],
  ] as [string, number][],
  fun: [
    ['Restaurant', null],
    ['Perima', 10],
    ['India Spend', null],
  ] as [string, number | null][],
  future: [
    ['Stocks & Gold ETF', 100],
    ['GRT', 480],
  ] as [string, number][],
};

describe('parseSheetMonth', () => {
  it.each([
    ['Nov 23', '2023-11'],
    ['Feb 24', '2024-02'],
    ['June 26', '2026-06'],
    ['July 24', '2024-07'],
    ['Sep 26', '2026-09'],
    [' Oct 26 ', '2026-10'],
    ['Template', null],
    ['Notes 2024', null],
    ['Foo 26', null],
  ])('%j → %j', (name, month) => expect(parseSheetMonth(name)).toBe(month));
});

describe('parseSpendingWorkbook', () => {
  it('reads the standard layout: income in C/D, buckets from row 16, sheet totals cross-checked', async () => {
    const { months, skippedSheets } = await parseSpendingWorkbook(
      await buildWorkbook([{ name: 'Template' }, september]),
    );
    expect(skippedSheets).toEqual(['Template']);
    expect(months).toHaveLength(1);
    const m = months[0]!;
    expect(m).toMatchObject({ sheet: 'Sep 26', month: '2026-09', matches: true, warnings: [] });
    expect(m.income).toEqual([
      { label: 'Salary', amount: 375_000 },
      { label: 'Tax', amount: 200_000 },
    ]);
    expect(m.items).toEqual([
      { bucket: 'essentials', label: 'Rent', amount: 91_200 },
      { bucket: 'essentials', label: 'Phone bill', amount: 2_000 },
      { bucket: 'essentials', label: 'Icici Insurance', amount: 5_800 },
      { bucket: 'fun', label: 'Perima', amount: 1_000 },
      { bucket: 'future', label: 'Stocks & Gold ETF', amount: 10_000 },
      { bucket: 'future', label: 'GRT', amount: 48_000 },
    ]);
    expect(m.sheetTotals).toEqual({ netIncome: 575_000, spend: 158_000 });
    expect(m.parsedTotals).toEqual({ netIncome: 575_000, spend: 158_000 });
  });

  it('reads the old Nov-23 layout: income in A/B, header on row 7', async () => {
    const { months } = await parseSpendingWorkbook(
      await buildWorkbook([
        {
          name: 'Nov 23',
          layout: 'old',
          income: [
            [5, 3347],
            ['Side hustle', null],
          ],
          essentials: [['Rent', 418]],
          fun: [['Netflix', 6]],
          future: [['Stocks', 222]],
        },
      ]),
    );
    expect(months[0]).toMatchObject({
      month: '2023-11',
      income: [{ label: '5', amount: 334_700 }],
      matches: true,
    });
    expect(months[0]!.items.map((i) => i.bucket)).toEqual(['essentials', 'fun', 'future']);
  });

  it("flags a month whose rows don't add up to the sheet's own totals", async () => {
    const { months } = await parseSpendingWorkbook(
      await buildWorkbook([{ ...september, spend: 2_000 }]),
    );
    expect(months[0]).toMatchObject({ matches: false });
    expect(months[0]!.sheetTotals.spend).toBe(200_000);
  });

  it('uses cached results of formula totals, keeps decimals, skips zero and blank', async () => {
    const { months } = await parseSpendingWorkbook(
      await buildWorkbook([
        {
          name: 'Oct 26',
          formulaTotals: true,
          income: [['Salary', 3750.5]],
          essentials: [
            ['Rent', 912.25],
            ['Water', 0],
          ],
        },
      ]),
    );
    expect(months[0]).toMatchObject({
      matches: true,
      income: [{ label: 'Salary', amount: 375_050 }],
      items: [{ bucket: 'essentials', label: 'Rent', amount: 91_225 }],
    });
  });

  it('warns about negative amounts and unlabeled amounts, skipping negatives', async () => {
    const { months } = await parseSpendingWorkbook(
      await buildWorkbook([
        {
          name: 'Oct 26',
          income: [['Salary', 100]],
          fun: [['Refund', -20]],
          spend: null,
          extraCells: [
            ['E17', null],
            ['F17', 7],
          ],
        },
      ]),
    );
    const m = months[0]!;
    expect(m.items).toEqual([{ bucket: 'future', label: '(no label)', amount: 700 }]);
    expect(m.warnings).toEqual([
      'Fun "Refund": negative amount -20 skipped',
      'Future You row 17: amount without a label',
    ]);
  });

  it('skips sheets that are not months or have nothing in them, and sorts months', async () => {
    const { months, skippedSheets } = await parseSpendingWorkbook(
      await buildWorkbook([
        { ...september, name: 'Sep 26' },
        { name: 'Feb 24', income: [['Salary', 1]] },
        { name: 'Oct 26' },
        { name: 'Notes' },
      ]),
    );
    expect(months.map((m) => m.month)).toEqual(['2024-02', '2026-09']);
    expect(skippedSheets).toEqual(['Oct 26 (empty)', 'Notes']);
  });

  it('rejects files that are not xlsx workbooks', async () => {
    await expect(parseSpendingWorkbook(Buffer.from('hello'))).rejects.toMatchObject({
      code: 'INVALID_WORKBOOK',
    });
  });

  it('rejects a workbook with no month sheets (e.g. only a Template) with NO_MONTHS', async () => {
    await expect(
      parseSpendingWorkbook(await buildWorkbook([{ name: 'Template' }])),
    ).rejects.toMatchObject({
      code: 'NO_MONTHS',
      message: expect.stringContaining('Template'),
    });
  });

  it('rejects a zip file that is not a workbook', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<doc/>');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(parseSpendingWorkbook(buf)).rejects.toMatchObject({ code: 'INVALID_WORKBOOK' });
  });

  it('rejects zip bombs before decompressing them', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/huge.xml', 'a'.repeat(60_000_000));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(buf.length).toBeLessThan(1_000_000);
    await expect(parseSpendingWorkbook(buf)).rejects.toMatchObject({ code: 'WORKBOOK_TOO_LARGE' });
  });

  it('ignores impossible years in sheet names', () => {
    expect(parseSheetMonth('Nov 0000')).toBeNull();
    expect(parseSheetMonth('Nov 2199')).toBeNull();
  });
});
