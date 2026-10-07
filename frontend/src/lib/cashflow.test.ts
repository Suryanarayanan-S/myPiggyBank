import { describe, expect, it } from 'vitest';
import { cashFlowRows } from './cashflow';

const month = (p: Record<string, number>) => ({
  month: '2026-09',
  netIncome: 0,
  essentials: 0,
  fun: 0,
  future: 0,
  uncategorised: 0,
  spent: 0,
  unused: 0,
  ...p,
});

describe('cashFlowRows', () => {
  it('keeps Essentials as on the Budget page and shows uncategorised spending separately', () => {
    const [row] = cashFlowRows([month({ essentials: 100, uncategorised: 30, fun: 20 })]);
    expect(row).toMatchObject({ label: 'Sep 26', essentials: 100, uncategorised: 30, fun: 20 });
    expect(row!.stackTop).toBe(150);
  });
});
