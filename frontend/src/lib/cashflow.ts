import { shortMonth } from './chart';

type MonthMoney = {
  month: string;
  netIncome: number;
  essentials: number;
  fun: number;
  future: number;
  uncategorised: number;
  unused: number;
};

/** Chart rows: Essentials exactly as on Spending → Budget; uncategorised spending is its own segment. */
export function cashFlowRows<T extends MonthMoney>(months: T[]) {
  return months.map((m) => ({
    ...m,
    label: shortMonth(m.month),
    stackTop: m.essentials + m.uncategorised + m.fun + m.future,
  }));
}
