import { formatMoney } from './money';
import { formatPercent } from './percent';

export type InsightTotals = {
  netIncome: number;
  essentials: number;
  fun: number;
  future: number;
  spent: number;
  unused: number;
  savingsRateBp: number | null;
  sharesBp: { essentials: number | null; fun: number | null; future: number | null };
};
export type Insight = { tone: 'good' | 'warning' | 'info'; text: string };

const pct = (fraction: number) => `${(Math.abs(fraction) * 100).toFixed(1)} %`;

/** Factual observations computed from the numbers — comparisons, never advice. */
export function insightsFor(
  t: InsightTotals,
  previous: InsightTotals | null,
  targets: { essentials: number; fun: number; future: number },
  currency: string,
  categories: { name: string; actual: number; bucket: string | null }[],
): Insight[] {
  const out: Insight[] = [];
  const money = (c: number) => formatMoney(c, currency);

  if (t.netIncome === 0) {
    out.push({ tone: 'info', text: 'No income recorded in this period yet.' });
    return out;
  }

  if (previous && previous.spent > 0) {
    const change = (t.spent - previous.spent) / previous.spent;
    const vs = `(${money(t.spent)} vs ${money(previous.spent)})`;
    if (Math.abs(change) < 0.05)
      out.push({
        tone: 'info',
        text: `Spending was about the same as in the previous period ${vs}.`,
      });
    else
      out.push({
        tone: change > 0 ? 'warning' : 'good',
        text: `Spending was ${pct(change)} ${change > 0 ? 'higher' : 'lower'} than in the previous period ${vs}.`,
      });
  }

  if (previous?.savingsRateBp != null && t.savingsRateBp !== null) {
    const diff = t.savingsRateBp - previous.savingsRateBp;
    const now = formatPercent(t.savingsRateBp);
    const before = formatPercent(previous.savingsRateBp);
    // Same threshold both ways: within ±0.5 pp counts as "about the same".
    if (diff >= 50)
      out.push({
        tone: 'good',
        text: `Savings rate ${now}, up from ${before} in the previous period.`,
      });
    else if (diff <= -50)
      out.push({
        tone: 'warning',
        text: `Savings rate ${now}, down from ${before} in the previous period.`,
      });
    else
      out.push({
        tone: 'info',
        text: `Savings rate ${now}, about the same as the previous period (${before}).`,
      });
  }

  const off: Insight[] = [];
  const share = t.sharesBp;
  if (share.essentials !== null && share.essentials > targets.essentials * 100)
    off.push({
      tone: 'warning',
      text: `Essentials took ${formatPercent(share.essentials)} of income, above its ${targets.essentials} % target.`,
    });
  if (share.fun !== null && share.fun > targets.fun * 100)
    off.push({
      tone: 'warning',
      text: `Fun took ${formatPercent(share.fun)} of income, above its ${targets.fun} % target.`,
    });
  if (share.future !== null && share.future < targets.future * 100)
    off.push({
      tone: 'warning',
      text: `Future You got ${formatPercent(share.future)} of income, below its ${targets.future} % target.`,
    });
  if (off.length) out.push(...off);
  else
    out.push({
      tone: 'good',
      text: `All three buckets are within their ${targets.essentials} / ${targets.fun} / ${targets.future} targets.`,
    });

  // Future You is saving, not an expense, so it never counts as the "largest expense".
  const top = categories.find((c) => c.bucket !== 'future');
  if (top && t.spent > 0) {
    const spending = t.spent;
    out.push({
      tone: 'info',
      text: `${top.name} was the largest expense: ${money(top.actual)} (${pct(top.actual / spending)} of spending).`,
    });
  }
  return out;
}
