import { describe, expect, it } from 'vitest';
import { yearReport, type PeriodNumbers } from '../../src/domain/report.js';

const money = (o: Partial<Record<string, number>> = {}) => ({
  netIncome: 0,
  essentials: 0,
  fun: 0,
  future: 0,
  uncategorised: 0,
  spent: 0,
  unused: 0,
  savingsRateBp: null as number | null,
  ...o,
});
const period = (
  months: { month: string; netIncome?: number; essentials?: number; future?: number }[],
  extra: Partial<PeriodNumbers> = {},
): PeriodNumbers => ({
  months: months.map(({ month, ...amounts }) => ({ month, ...money(amounts) })),
  totals: money({
    netIncome: months.reduce((s, m) => s + (m.netIncome ?? 0), 0),
    essentials: months.reduce((s, m) => s + (m.essentials ?? 0), 0),
    future: months.reduce((s, m) => s + (m.future ?? 0), 0),
  }),
  categories: [],
  members: [],
  ...extra,
});
const year = (y: number, filled: Record<number, { netIncome: number; essentials: number }>) =>
  period(
    Array.from({ length: 12 }, (_, i) => ({
      month: `${y}-${String(i + 1).padStart(2, '0')}`,
      ...(filled[i + 1] ?? {}),
    })),
  );

describe('yearReport', () => {
  it('marks recorded months and averages over them only', () => {
    const r = yearReport(
      year(2026, {
        1: { netIncome: 300_000, essentials: 100_000 },
        2: { netIncome: 500_000, essentials: 200_000 },
      }),
      year(2025, {}),
    );
    expect(r.months.filter((m) => m.recorded).map((m) => m.month)).toEqual(['2026-01', '2026-02']);
    expect(r.recordedMonths).toBe(2);
    expect(r.averages).toMatchObject({ netIncome: 400_000, essentials: 150_000 });
    expect(r.previous).toBeNull(); // nothing recorded in 2025
  });

  it('compares with a partly recorded previous year and says how much of it was recorded', () => {
    const r = yearReport(
      year(2026, { 1: { netIncome: 500_000, essentials: 200_000 } }),
      year(2025, {
        11: { netIncome: 400_000, essentials: 100_000 },
        12: { netIncome: 400_000, essentials: 300_000 },
      }),
    );
    expect(r.previous).toMatchObject({ recordedMonths: 2, totals: { netIncome: 800_000 } });
    // 1 month against 2: compared per month (500,000 vs 400,000), never 1 month vs 2 months.
    expect(r.changeBasis).toBe('average');
    expect(r.change.netIncome).toEqual({ amount: 100_000, bp: 2500 });
    expect(r.change.fun).toEqual({ amount: 0, bp: null });
  });

  it('merges categories and people across both years by id, largest this year first', () => {
    const r = yearReport(
      period([{ month: '2026-01', netIncome: 1 }], {
        categories: [
          { categoryId: 'rent', name: 'Rent', bucket: 'essentials', actual: 900_000 },
          { categoryId: 'new', name: 'Childcare', bucket: 'essentials', actual: 50_000 },
        ],
        members: [{ memberId: null, name: 'Shared', actual: 10 }],
      }),
      period([{ month: '2025-01', netIncome: 1 }], {
        categories: [
          { categoryId: 'rent', name: 'Rent', bucket: 'essentials', actual: 800_000 },
          { categoryId: 'old', name: 'Gym', bucket: 'fun', actual: 30_000 },
        ],
        members: [{ memberId: null, name: 'Shared', actual: 20 }],
      }),
    );
    expect(r.categories.map((c) => [c.name, c.actual, c.previous, c.changeBp])).toEqual([
      ['Rent', 900_000, 800_000, 1250],
      ['Childcare', 50_000, 0, null],
      ['Gym', 0, 30_000, -10_000],
    ]);
    expect(r.members).toEqual([
      { memberId: null, name: 'Shared', actual: 10, previous: 20, changeBp: -5000 },
    ]);
  });

  it('uses the recorded months it is given (any entry counts, even without a rate)', () => {
    const r = yearReport(year(2026, {}), year(2025, {}), {
      recorded: new Set(['2026-03']),
      previousRecorded: new Set(),
    });
    expect(r.recordedMonths).toBe(1);
    expect(r.months.find((m) => m.month === '2026-03')!.recorded).toBe(true);
  });
});
