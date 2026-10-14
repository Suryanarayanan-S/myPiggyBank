/** How a savings goal is doing. Amounts are minor units of the goal's currency. */
export type GoalProgress = {
  /** saved / target in basis points (may exceed 10 000) */
  pctBp: number;
  left: number;
  /** average change per month over the last 3 months */
  pace: number;
  monthsLeft: number | null;
  monthlyNeeded: number | null;
  onTrack: boolean | null;
  reached: boolean;
  overdue: boolean;
};

/** Whole months from `from` to `to` (YYYY-MM-DD); a later day-of-month counts the month. */
export function monthsUntil(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm);
  const lastDayOfTo = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  if (td < fd && td < lastDayOfTo) months -= 1; // not a full month yet (month ends excepted)
  return Math.max(1, months);
}

export function goalProgress(input: {
  target: number;
  saved: number;
  /** saved 3 months before today */
  savedBefore: number;
  today: string;
  targetDate: string | null;
}): GoalProgress {
  const { target, saved, today, targetDate } = input;
  const left = Math.max(0, target - saved);
  const reached = left === 0;
  const pace = Math.round((saved - input.savedBefore) / 3);
  const pctBp = Math.round((saved * 10_000) / target);
  if (!targetDate) {
    return {
      pctBp,
      left,
      pace,
      monthsLeft: null,
      monthlyNeeded: null,
      onTrack: reached ? true : null,
      reached,
      overdue: false,
    };
  }
  const overdue = !reached && targetDate < today;
  const monthsLeft = overdue ? 0 : monthsUntil(today, targetDate);
  const monthlyNeeded = reached ? 0 : overdue ? left : Math.ceil(left / monthsLeft);
  return {
    pctBp,
    left,
    pace,
    monthsLeft,
    monthlyNeeded,
    onTrack: reached || (!overdue && pace >= monthlyNeeded),
    reached,
    overdue,
  };
}
