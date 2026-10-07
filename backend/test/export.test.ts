import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, resetDb, signUp } from './helpers.js';

describe('CSV export', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
    const acc = (
      await call('POST', '/api/accounts', { name: 'Sparkasse', type: 'current', currency: 'EUR' })
    ).json().data;
    const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
    const groceries = cats.find((c) => c.name === 'Groceries')!.id;
    await call('POST', '/api/transactions', {
      date: '2026-10-02',
      amount: 5_240,
      type: 'expense',
      accountId: acc.id,
      categoryId: groceries,
      merchant: 'REWE; "Markt"',
      tags: ['food'],
    });
    await call('POST', '/api/transactions', {
      date: '2026-10-03',
      amount: 100,
      type: 'expense',
      accountId: acc.id,
      merchant: '=HYPERLINK("http://evil")',
    });
    await call('POST', '/api/transactions', {
      date: '2026-09-01',
      amount: 1,
      type: 'expense',
      accountId: acc.id,
      merchant: 'September',
    });
  });
  afterEach(() => app.close());

  it('exports the period as a spreadsheet-friendly CSV', async () => {
    const res = await call('GET', '/api/export/transactions.csv?from=2026-10-01&to=2026-10-31');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(
      'transactions-2026-10-01-to-2026-10-31.csv',
    );
    expect(res.body.charCodeAt(0)).toBe(0xfeff); // BOM so Excel reads UTF-8
    const lines = res.body.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(
      'Date;Type;Amount;Currency;Account;Category;Bucket;Member;Merchant;Notes;Tags',
    );
    expect(lines).toHaveLength(3);
    expect(lines).toContain(
      '2026-10-02;expense;-52,40;EUR;Sparkasse;Groceries;Essentials;Shared;"REWE; ""Markt""";;food',
    );
  });

  it('neutralises spreadsheet formulas in text cells', async () => {
    const res = await call('GET', '/api/export/transactions.csv?from=2026-10-01&to=2026-10-31');
    expect(res.body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.body).not.toMatch(/;=HYPERLINK/);
  });

  it("only exports the caller's family", async () => {
    const other = client(app, (await signUp(app)).cookie);
    const res = await other('GET', '/api/export/transactions.csv?from=2026-10-01&to=2026-10-31');
    expect(res.statusCode).toBe(200);
    expect(res.body.slice(1).trim().split('\r\n')).toHaveLength(1);
  });
});
