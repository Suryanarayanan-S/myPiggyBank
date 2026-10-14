import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';
import { sparkasseCsv } from './fixtures/bankCsv.js';

type Analysed = {
  index: number;
  date: string | null;
  amount: number | null;
  type: 'income' | 'expense';
  description: string;
  error: string | null;
  duplicate: 'file' | 'existing' | 'possible' | null;
  suggestion: string | null;
};

describe('bank CSV import', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let account: { id: string };
  let cat: (n: string) => string;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
    account = (
      await call('POST', '/api/accounts', { name: 'Sparkasse', type: 'current', currency: 'EUR' })
    ).json().data;
    const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
    cat = (n) => cats.find((c) => c.name === n)!.id;
  });
  afterEach(() => app.close());

  const preview = async (buf = sparkasseCsv()) =>
    (
      await call('POST', '/api/import/csv/preview', {
        fileName: 'umsatz.csv',
        data: buf.toString('base64'),
      })
    ).json().data;
  const mapping = {
    date: 1,
    description: 4,
    payee: 5,
    amount: 8,
    dateFormat: 'dd.mm.yyyy',
    decimal: ',',
    invert: false,
  };
  const analyse = async (
    rows: string[][],
    extra: object = {},
  ): Promise<{ rows: Analysed[]; summary: Record<string, number> }> =>
    (
      await call('POST', '/api/import/csv/analyze', {
        accountId: account.id,
        rows,
        mapping,
        ...extra,
      })
    ).json().data;
  const commitAll = async (rows: Analysed[], remember: object[] = []) =>
    call('POST', '/api/import/csv/commit', {
      accountId: account.id,
      rows: rows
        .filter((r) => !r.error && !r.duplicate)
        .map((r) => ({
          date: r.date,
          amount: r.amount,
          type: r.type,
          description: r.description,
          categoryId: r.suggestion,
        })),
      rememberRules: remember,
    });

  it('previews the file with guessed columns', async () => {
    const p = await preview();
    expect(p.delimiter).toBe(';');
    expect(p.headers[8]).toBe('Betrag');
    expect(p.rows).toHaveLength(5);
    expect(p.mapping).toMatchObject({ date: 1, description: 4, payee: 5, amount: 8 });
  });

  it('analyses rows: signs to income/expense, payee + purpose as description, suggestions', async () => {
    const p = await preview();
    const a = await analyse(p.rows);
    expect(a.rows.map((r) => [r.date, r.amount, r.type, r.suggestion])).toEqual([
      ['2026-10-01', 375_000, 'income', cat('Salary')],
      ['2026-10-02', 5_240, 'expense', cat('Groceries')],
      ['2026-10-03', 91_200, 'expense', cat('Rent')],
      ['2026-10-04', 1_299, 'expense', cat('Subscriptions')],
      ['2026-10-05', 480, 'expense', null],
    ]);
    expect(a.rows[1]!.description).toBe('REWE · REWE Markt; Filiale 123');
    expect(a.summary).toEqual({ total: 5, valid: 5, invalid: 0, duplicates: 0 });
  });

  it('flags invalid rows and duplicates inside the file', async () => {
    const p = await preview();
    const rows = [
      ...p.rows,
      p.rows[1],
      [...p.rows[2].slice(0, 1), '31.02.26', ...p.rows[2].slice(2)],
    ];
    const a = await analyse(rows);
    expect(a.rows[5]).toMatchObject({ duplicate: 'file' });
    expect(a.rows[6]!.error).toMatch(/date/i);
    expect(a.summary).toMatchObject({ invalid: 1, duplicates: 1 });
  });

  it('honours inverted signs', async () => {
    const p = await preview();
    const a = await analyse(p.rows.slice(1, 2), { mapping: { ...mapping, invert: true } });
    expect(a.rows[0]).toMatchObject({ type: 'income', amount: 5_240 });
  });

  it('imports the confirmed rows, learns a rule, and a second import finds only duplicates', async () => {
    const p = await preview();
    const first = await analyse(p.rows);
    first.rows[4]!.suggestion = cat('Restaurants');
    const res = await commitAll(first.rows, [
      { pattern: 'Bäckerei', categoryId: cat('Restaurants') },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ created: 5 });
    const t = await prisma.transaction.findFirstOrThrow({ where: { amount: 5_240 } });
    expect(t).toMatchObject({
      merchant: 'REWE · REWE Markt; Filiale 123',
      notes: 'Imported from bank statement',
    });
    expect(t.importBatch).toMatch(/^csv:/);

    const again = await analyse(p.rows);
    expect(again.rows.every((r) => r.duplicate === 'existing')).toBe(true);
    expect(again.rows[4]!.suggestion).toBe(cat('Restaurants')); // learned
  });

  it('rejects a category whose kind does not fit, and foreign accounts or categories (404), writing nothing', async () => {
    const row = {
      date: '2026-10-02',
      amount: 5_240,
      type: 'expense',
      description: 'REWE',
      categoryId: cat('Salary'),
    };
    const bad = await call('POST', '/api/import/csv/commit', {
      accountId: account.id,
      rows: [row],
    });
    expect(bad.statusCode).toBe(400);
    const other = client(app, (await signUp(app)).cookie);
    const otherAcc = (
      await other('POST', '/api/accounts', { name: 'X', type: 'cash', currency: 'EUR' })
    ).json().data;
    const res = await call('POST', '/api/import/csv/commit', {
      accountId: otherAcc.id,
      rows: [{ ...row, categoryId: null }],
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('rejects files that are not text tables', async () => {
    const res = await call('POST', '/api/import/csv/preview', {
      fileName: 'x.csv',
      data: Buffer.from('').toString('base64'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('keeps imported merchants editable (≤ 100 characters) and stores the full text in the notes', async () => {
    const long =
      'SEPA Lastschrift Stadtwerke München GmbH Abschlag Strom und Gas Vertragskonto 1234567890 Mandat XYZ';
    const res = await call('POST', '/api/import/csv/commit', {
      accountId: account.id,
      rows: [
        {
          date: '2026-10-02',
          amount: 9_900,
          type: 'expense',
          description: `Stadtwerke · ${long}`,
          categoryId: null,
        },
      ],
    });
    expect(res.statusCode).toBe(200);
    const t = await prisma.transaction.findFirstOrThrow({});
    expect(t.merchant!.length).toBeLessThanOrEqual(100);
    expect(t.notes).toContain(long);
    const edit = await call('PUT', `/api/transactions/${t.id}`, {
      date: '2026-10-02',
      amount: 9_900,
      type: 'expense',
      accountId: account.id,
      merchant: t.merchant,
      notes: t.notes,
      categoryId: cat('Electricity'),
    });
    expect(edit.statusCode).toBe(200);
    const again = await analyse([['x', '02.10.26', '', '', long, 'Stadtwerke', '', '', '-99,00']]);
    expect(again.rows[0]!.duplicate).toBe('existing');
  });

  it('flags a possible duplicate: same account, amount and type within 5 days, whatever the text', async () => {
    await call('POST', '/api/transactions', {
      date: '2026-10-07',
      amount: 91_200,
      type: 'expense',
      accountId: account.id,
      merchant: 'Rent',
    });
    await call('POST', '/api/transactions', {
      date: '2026-10-02',
      amount: 5_240,
      type: 'expense',
      accountId: account.id,
      merchant: 'Rewe',
    });
    const p = await preview();
    const a = await analyse(p.rows);
    expect(a.rows.map((r) => r.duplicate)).toEqual([null, 'possible', 'possible', null, null]);
    expect(a.summary.duplicates).toBe(2);
  });

  it('a payment entered without an account, in the same currency, is a possible duplicate', async () => {
    const rent = { date: '2026-10-07', amount: 91_200, type: 'expense', merchant: 'Rent' };
    await call('POST', '/api/transactions', { ...rent, accountId: null });
    // Another currency is a different payment.
    await call('POST', '/api/transactions', {
      ...rent,
      date: '2026-10-02',
      amount: 5_240,
      accountId: null,
      currency: 'INR',
    });
    const a = await analyse((await preview()).rows);
    expect(a.rows.map((r) => r.duplicate)).toEqual([null, null, 'possible', null, null]);
  });
});
