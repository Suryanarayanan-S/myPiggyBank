export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
type Rule = { frequency: Frequency; startDate: string; endDate: string | null };

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The n-th occurrence (n = 0 is the start date); month-based days clamp to the month end. */
function nth(rule: Rule, n: number): string {
  const start = toDate(rule.startDate);
  if (rule.frequency === 'weekly') return fmt(new Date(start.getTime() + n * 7 * 86_400_000));
  const step = rule.frequency === 'monthly' ? 1 : rule.frequency === 'quarterly' ? 3 : 12;
  const months = start.getUTCMonth() + n * step;
  const y = start.getUTCFullYear() + Math.floor(months / 12);
  const m = ((months % 12) + 12) % 12;
  return fmt(new Date(Date.UTC(y, m, Math.min(start.getUTCDate(), lastDay(y, m)))));
}

/** All occurrences between `from` and `to` (inclusive), within the rule's start and end dates. */
export function occurrences(rule: Rule, from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = 0; n < 10_000; n++) {
    const d = nth(rule, n);
    if (d > to || (rule.endDate && d > rule.endDate)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** First occurrence strictly after `after`, or null when the rule has ended. */
export function nextOccurrence(rule: Rule, after: string): string | null {
  for (let n = 0; n < 10_000; n++) {
    const d = nth(rule, n);
    if (rule.endDate && d > rule.endDate) return null;
    if (d > after) return d;
  }
  return null;
}
