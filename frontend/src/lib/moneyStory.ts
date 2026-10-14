import type { BucketNames } from './buckets';
import { formatMoney } from './money';
import { formatPercent } from './percent';

/** One month of the dashboard, as much as the story needs. */
export type StoryMonth = {
  month: string;
  netIncome: number;
  essentials: number;
  fun: number;
  future: number;
  uncategorised: number;
  unused: number;
  savingsRateBp: number | null;
};
export type StoryLine = { icon: string; text: string };
export type Story = { month: string; title: string; lines: StoryLine[] };

const recorded = (m: StoryMonth) =>
  m.netIncome > 0 || m.essentials + m.fun + m.future + m.uncategorised > 0;
const monthName = (month: string, withYear = false) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    ...(withYear && { year: 'numeric' }),
    timeZone: 'UTC',
  });

/** The biggest spending of the month in a real category (not saving, not uncategorised). */
export function topSpender(
  categories: { categoryId: string | null; name: string; bucket: string | null; actual: number }[],
): { name: string; actual: number } | null {
  const top = [...categories]
    .filter((c) => c.categoryId !== null && c.bucket !== 'future' && c.actual > 0)
    .sort((a, b) => b.actual - a.actual)[0];
  return top ? { name: top.name, actual: top.actual } : null;
}

/** The month the story is about: the latest one with anything recorded. */
export function storyMonth(months: StoryMonth[]): string | null {
  return months.filter(recorded).at(-1)?.month ?? null;
}

/**
 * A light-hearted recap of the latest recorded month, compared with the average of the recorded
 * months before it ("usual"). It only describes the numbers — never advice.
 */
export function moneyStory({
  months,
  top,
  names,
  currency,
  unconverted = [],
}: {
  /** Chronological; the story is about the latest recorded one. */
  months: StoryMonth[];
  /** Biggest spending category of that month (saving excluded). */
  top: { name: string; actual: number } | null;
  names: BucketNames;
  currency: string;
  /** Money of that month without an exchange rate into `currency`. */
  unconverted?: { currency: string; amount: number }[];
}): Story | null {
  const all = months.filter(recorded);
  const now = all.at(-1);
  if (!now) return null;
  const before = all.slice(0, -1);
  const money = (c: number) => formatMoney(c, currency);
  const usual = (key: 'essentials' | 'fun' | 'future') => {
    if (!before.length) return null;
    const avg = before.reduce((s, m) => s + m[key], 0) / before.length;
    return avg > 0 ? avg : null;
  };
  // The mood is chosen from the rounded percentage that is shown, so "10 %" never reads oddly.
  const pct = (ratio: number) => Math.round((ratio - 1) * 100);
  const off = (ratio: number) => `${Math.abs(pct(ratio))} %`;
  const lines: StoryLine[] = [];

  const e = now.essentials;
  const eUsual = usual('essentials');
  const eRatio = eUsual ? e / eUsual : null;
  lines.push({
    icon: '🏠',
    text:
      e === 0
        ? `${names.essentials} cost nothing this month.`
        : eRatio === null
          ? `${names.essentials} cost ${money(e)}.`
          : pct(eRatio) <= -10
            ? `${names.essentials} behaved: ${money(e)}, ${off(eRatio)} less than usual.`
            : pct(eRatio) <= 10
              ? `${names.essentials} behaved: ${money(e)}, right around its usual.`
              : `${names.essentials} got hungry: ${money(e)}, ${off(eRatio)} more than usual.`,
  });

  const f = now.fun;
  const fUsual = usual('fun');
  const fRatio = fUsual ? f / fUsual : null;
  lines.push({
    icon: '🎉',
    text:
      f === 0
        ? `${names.fun} stayed home all month.`
        : fRatio === null
          ? `${names.fun} spent ${money(f)}.`
          : pct(fRatio) <= -50
            ? `${names.fun} barely left the house: ${money(f)}, ${off(fRatio)} less than usual.`
            : pct(fRatio) < -10
              ? `${names.fun} kept it low-key: ${money(f)}, ${off(fRatio)} less than usual.`
              : pct(fRatio) <= 10
                ? `${names.fun} had its usual fun: ${money(f)}.`
                : pct(fRatio) <= 50
                  ? `${names.fun} went out a bit more: ${money(f)}, ${off(fRatio)} more than usual.`
                  : `${names.fun} took a holiday: ${money(f)}, ${off(fRatio)} more than usual.`,
  });

  const r = now.future;
  const rUsual = usual('future');
  const rRatio = rUsual ? r / rUsual : null;
  lines.push({
    icon: '🌱',
    text:
      r === 0
        ? `${names.future} took the month off.`
        : rRatio === null
          ? `${names.future} grew by ${money(r)}.`
          : pct(rRatio) > 10
            ? `${names.future} had a growth spurt: ${money(r)}, ${off(rRatio)} more than usual.`
            : pct(rRatio) < -10
              ? `${names.future} grew by ${money(r)}, a slower month than usual (${off(rRatio)} less).`
              : `${names.future} grew by ${money(r)}, steady as usual.`,
  });

  if (now.savingsRateBp !== null) {
    const prev = before.at(-1);
    const rate = formatPercent(now.savingsRateBp);
    let text = `Savings rate ${rate}.`;
    if (prev && prev.savingsRateBp !== null) {
      const diff = now.savingsRateBp - prev.savingsRateBp;
      const was = `${formatPercent(prev.savingsRateBp)} in ${monthName(prev.month)}`;
      text =
        formatPercent(prev.savingsRateBp) === rate
          ? `Savings rate ${rate}, the same as in ${monthName(prev.month)}.`
          : `Savings rate ${rate}, ${diff > 0 ? 'up' : 'down'} from ${was}.`;
    }
    lines.push({ icon: '📈', text });
  }

  if (now.uncategorised > 0)
    lines.push({ icon: '🏷️', text: `${money(now.uncategorised)} still waiting for a category.` });

  if (top && top.actual > 0)
    lines.push({ icon: '🏆', text: `Biggest spender: ${top.name} at ${money(top.actual)}.` });

  if (now.unused > 0)
    lines.push({
      icon: '🐷',
      text: `${money(now.unused)} left unspent — the piggy bank says thanks.`,
    });
  else if (now.unused < 0)
    lines.push({
      icon: '🐷',
      text: `${money(-now.unused)} more went out than came in — the piggy bank felt a draft.`,
    });

  if (unconverted.length)
    lines.push({
      icon: '⚠️',
      text: `${unconverted.map((u) => formatMoney(u.amount, u.currency)).join(' and ')} had no exchange rate and ${unconverted.length > 1 ? 'are' : 'is'} left out.`,
    });

  return { month: now.month, title: `${monthName(now.month, true)} in a nutshell`, lines };
}
