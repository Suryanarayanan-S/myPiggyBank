import { formatMoney } from './money';

export type Insight = {
  id: string;
  kind:
    | 'rising'
    | 'vsAverage'
    | 'overLimit'
    | 'subscription'
    | 'savingsTrend'
    | 'goalBehind'
    | 'holding'
    | 'large';
  tone: 'warning' | 'info' | 'good';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the shape depends on the kind
  data: Record<string, any>;
  link: string;
  size: number;
};
export type InsightsResponse = {
  currency: string;
  insights: Insight[];
  unconverted: { currency: string; amount: number }[];
  /** budget limits that could not be compared (no exchange rate) */
  unconvertedLimits: number;
};

/** Size only — the words around it (above/below, up/down) carry the direction. */
const pct = (bp: number) => `${Math.round(Math.abs(bp) / 100)} %`;
/** A rate that can itself be negative (savings rate). */
const rate = (bp: number) => `${bp < 0 ? '−' : ''}${pct(bp)}`;
const signed = (cents: number, currency: string) =>
  `${cents < 0 ? '−' : '+'}${formatMoney(Math.abs(cents), currency)}`;
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
const dayMonth = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** One plain sentence per insight: what happened and the numbers — never what to do. */
export function insightText(i: Insight, currency: string): string {
  const m = (cents: number, cur = currency) => formatMoney(cents, cur);
  const d = i.data;
  switch (i.kind) {
    case 'rising':
      return `${d.category} rose three months in a row: ${d.amounts.map((a: number) => m(a)).join(' → ')}.`;
    case 'vsAverage':
      if (d.amount === 0) {
        return `Nothing on ${d.category} in ${monthName(d.month)} (usually ${m(d.usual)} a month).`;
      }
      return `In ${monthName(d.month)}, ${d.category} was ${pct(d.bp)} ${d.bp > 0 ? 'above' : 'below'} its usual (${m(d.amount)} vs ${m(d.usual)}).`;
    case 'overLimit':
      return `${d.category} is ${m(d.over)} over its limit this month${
        d.pastMonthsOver > 0 ? ` — also over in ${d.pastMonthsOver} of the last 6 months.` : '.'
      }`;
    case 'subscription':
      return `${d.merchant} looks like a regular payment: about ${m(d.monthly)} a month, ${m(d.yearly)} a year.`;
    case 'savingsTrend':
      return `Savings rate went ${d.recentBp > d.earlierBp ? 'up' : 'down'}: ${rate(d.recentBp)} over the last 3 months, ${rate(d.earlierBp)} the 3 before.`;
    case 'goalBehind':
      return d.overdue
        ? `${d.name} is past its date with ${m(d.left, d.currency)} still to save.`
        : `${d.name} is behind: ${m(d.monthlyNeeded, d.currency)} a month needed, ${
            d.pace > 0 ? `${m(d.pace, d.currency)} a month saved lately` : 'nothing saved lately'
          }.`;
    case 'holding':
      return `${d.name} is ${d.returnBp > 0 ? 'up' : 'down'} ${pct(d.returnBp)} (${signed(d.unrealised, d.currency)}).`;
    case 'large':
      return `${m(d.amount)}${d.merchant ? ` at ${d.merchant}` : ''} on ${dayMonth(d.date)} is about ${d.times}× a usual ${d.category} payment.`;
  }
}
