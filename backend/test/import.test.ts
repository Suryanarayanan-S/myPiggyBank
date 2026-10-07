import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';
import { buildWorkbook, type SheetSpec } from './fixtures/workbook.js';

const aug: SheetSpec = {
  name: 'Aug 26',
  income: [['Salary', 3750]],
  essentials: [
    ['Rent', 912],
    ['Phone bill', 20],
  ],
  fun: [
    ['Perima', 10],
    ['Dayana Kodi', 3500],
  ],
  future: [['GRT', 160]],
};
const sep: SheetSpec = {
  name: 'Sep 26',
  income: [
    ['Salary', 3750],
    ['Tax', 2000],
  ],
  essentials: [['Rent', 912]],
  fun: [['Perima', 10]],
  future: [['Stocks & Gold ETF', 100]],
};

type Preview = {
  months: {
    month: string;
    sheet: string;
    income: object[];
    items: object[];
    existing: { imported: number; manual: number };
    matches: boolean;
  }[];
  labels: {
    key: string;
    label: string;
    suggestion: { categoryId: string } | { newName: string };
  }[];
};

describe('spreadsheet import', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
  });
  afterEach(() => app.close());

  const upload = async (sheets: SheetSpec[]) =>
    call('POST', '/api/import/spreadsheet/preview', {
      fileName: 'Monthly Spending.xlsx',
      data: (await buildWorkbook(sheets)).toString('base64'),
    });
  const preview = async (sheets: SheetSpec[] = [aug, sep]): Promise<Preview> =>
    (await upload(sheets)).json().data;
  const mappingFrom = (p: Preview) =>
    Object.fromEntries(p.labels.map((l) => [l.key, l.suggestion]));
  const commit = (p: Preview, extra: Record<string, unknown> = {}) =>
    call('POST', '/api/import/spreadsheet/commit', {
      account: { newName: 'Spreadsheet history' },
      months: p.months.map((m) => ({ ...m, mode: 'import' })),
      mapping: mappingFrom(p),
      ...extra,
    });

  it('previews months, distinct labels with suggestions, and what already exists', async () => {
    const p = await preview();
    expect(p.months.map((m) => [m.month, m.matches, m.existing])).toEqual([
      ['2026-08', true, { imported: 0, manual: 0 }],
      ['2026-09', true, { imported: 0, manual: 0 }],
    ]);
    const label = (l: string) => p.labels.find((x) => x.label === l)!;
    expect(label('Rent').suggestion).toHaveProperty('categoryId');
    expect(label('Perima')).toMatchObject({
      key: 'expense|fun|perima',
      suggestion: { newName: 'Other fun' },
    });
    expect(p.labels.filter((l) => l.label === 'Salary')).toHaveLength(1); // aggregated across months
  });

  it('imports into a new account; the budget matches the sheet totals', async () => {
    const res = await commit(await preview());
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      created: 11,
      months: ['2026-08', '2026-09'],
      newCategories: ['Other fun'],
    });

    const acc = await prisma.account.findFirstOrThrow({ where: { name: 'Spreadsheet history' } });
    expect(acc).toMatchObject({ currency: 'EUR', type: 'other' });
    const t = await prisma.transaction.findFirstOrThrow({ where: { merchant: 'Dayana Kodi' } });
    expect(t).toMatchObject({
      type: 'expense',
      importBatch: 'xlsx:2026-08',
      notes: 'Imported from "Aug 26"',
    });
    expect(t.date.toISOString().slice(0, 10)).toBe('2026-08-01');

    const s = (await call('GET', '/api/budget/2026-08')).json().data;
    expect(s).toMatchObject({
      netIncome: 375_000,
      essentials: 93_200,
      fun: 351_000,
      future: 16_000,
    });
  });

  it('refuses to import a month twice (409), and preview reports it as already imported', async () => {
    await commit(await preview([aug]));
    const again = await preview([aug]);
    expect(again.months[0]!.existing.imported).toBe(6);
    const res = await commit(again);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MONTH_ALREADY_IMPORTED');
    expect(await prisma.transaction.count()).toBe(6);
  });

  it('replace swaps only that month’s imported rows and never touches manual ones', async () => {
    await commit(await preview([aug]));
    const acc = await prisma.account.findFirstOrThrow({ where: { name: 'Spreadsheet history' } });
    await call('POST', '/api/transactions', {
      date: '2026-08-20',
      amount: 999,
      type: 'expense',
      accountId: acc.id,
      merchant: 'manual',
    });
    const changed = await preview([{ ...aug, fun: [['Perima', 20]] }]);
    expect(changed.months[0]!.existing).toEqual({ imported: 6, manual: 1 });
    const res = await call('POST', '/api/import/spreadsheet/commit', {
      account: { id: acc.id },
      months: changed.months.map((m) => ({ ...m, mode: 'replace' })),
      mapping: mappingFrom(changed),
    });
    expect(res.statusCode).toBe(200);
    // the changed sheet has 5 rows (Dayana Kodi removed)
    expect(await prisma.transaction.count({ where: { importBatch: 'xlsx:2026-08' } })).toBe(5);
    expect(await prisma.transaction.count({ where: { merchant: 'manual' } })).toBe(1);
    const s = (await call('GET', '/api/budget/2026-08')).json().data;
    expect(s.fun).toBe(2_000 + 999);
  });

  it('reuses categories created by an earlier import', async () => {
    await commit(await preview([aug]));
    const p = await preview([sep]);
    expect(p.labels.find((l) => l.label === 'Perima')!.suggestion).toHaveProperty('categoryId');
    const res = await commit(p, { account: { newName: 'Spreadsheet history' } });
    expect(res.json().data.newCategories).toEqual([]);
    expect(await prisma.category.count({ where: { name: 'Other fun' } })).toBe(1);
    expect(await prisma.account.count({ where: { name: 'Spreadsheet history' } })).toBe(1);
  });

  it('honours a mapping changed by the user, including a new named category', async () => {
    const p = await preview([aug]);
    const mapping = mappingFrom(p);
    mapping['expense|fun|dayana kodi'] = { newName: 'Family events' };
    await commit(p, { mapping });
    const t = await prisma.transaction.findFirstOrThrow({
      where: { merchant: 'Dayana Kodi' },
      include: { category: true },
    });
    expect(t.category).toMatchObject({ name: 'Family events', bucket: 'fun' });
  });

  it('rejects a missing mapping (400) and a mapping into the wrong bucket (400), writing nothing', async () => {
    const p = await preview([aug]);
    const missing = mappingFrom(p);
    delete missing['expense|fun|perima'];
    expect((await commit(p, { mapping: missing })).statusCode).toBe(400);

    const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
    const wrong = {
      ...mappingFrom(p),
      'expense|fun|perima': { categoryId: cats.find((c) => c.name === 'Rent')!.id },
    };
    expect((await commit(p, { mapping: wrong })).statusCode).toBe(400);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("rejects another family's account or category with 404, writing nothing", async () => {
    const p = await preview([aug]);
    const other = client(app, (await signUp(app)).cookie);
    const otherAcc = (
      await other('POST', '/api/accounts', { name: 'X', type: 'cash', currency: 'EUR' })
    ).json().data;
    const otherCats: { id: string; name: string }[] = (await other('GET', '/api/categories')).json()
      .data;
    const acc = await commit(p, { account: { id: otherAcc.id } });
    expect(acc.statusCode).toBe(404);
    expect(acc.json().error.message).toBe('Account not found');
    const cat = await commit(p, {
      mapping: {
        ...mappingFrom(p),
        'expense|essentials|rent': { categoryId: otherCats.find((c) => c.name === 'Rent')!.id },
      },
    });
    expect(cat.statusCode).toBe(404);
    expect(cat.json().error.message).toBe('Category not found');
    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.account.count({ where: { name: 'Spreadsheet history' } })).toBe(0);
  });

  it('refuses an account that is not in the spending currency', async () => {
    const inr = (
      await call('POST', '/api/accounts', { name: 'ICICI', type: 'savings', currency: 'INR' })
    ).json().data;
    const res = await commit(await preview([aug]), { account: { id: inr.id } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ACCOUNT_CURRENCY');
  });

  it('rejects files that are not workbooks with a clear 400', async () => {
    const res = await call('POST', '/api/import/spreadsheet/preview', {
      fileName: 'notes.xlsx',
      data: Buffer.from('not a spreadsheet').toString('base64'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_WORKBOOK');
  });

  it('accepts a realistic upload larger than 1 MB (the real workbook is 1.2 MB)', async () => {
    const noise = Array.from({ length: 70 }, (_, i): [string, string] => [
      `A${i + 1}`,
      randomBytes(15_000).toString('hex'),
    ]);
    const data = (await buildWorkbook([aug, { name: 'Notes', extraCells: noise }])).toString(
      'base64',
    );
    expect(data.length).toBeGreaterThan(1_100_000);
    const res = await call('POST', '/api/import/spreadsheet/preview', {
      fileName: 'big.xlsx',
      data,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.months).toHaveLength(1);
  });

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/spreadsheet/preview',
      payload: { fileName: 'x', data: '' },
    });
    expect(res.statusCode).toBe(401);
  });
});
