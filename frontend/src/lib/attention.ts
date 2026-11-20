import { recentActions, actionText } from './corporateActions';
import type { Holding } from './investments';

export type AttentionItem = { key: string; text: string; link: string };

/** corporate actions are "new" this long; the Investments page lists them for two months */
const NEW_DAYS = 7;
/** daily prices older than this (a long weekend and a holiday fit in) are out of date */
const STALE_DAYS = 5;
const DAY = 86_400_000;

/** a share's symbol, or its name where the symbol is an ISIN (shares bought outside India) */
const label = (h: Holding) =>
  h.symbol && !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(h.symbol) ? h.symbol : h.name;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "A, B, C, D, E and 3 more" */
const some = (names: string[], max = 5) =>
  names.length > max
    ? `${names.slice(0, max).join(', ')} and ${names.length - max} more`
    : names.join(', ');
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/**
 * What needs a look, for the dashboard — only things the user can act on, each with the page
 * where it is done: income and payments without a category, new corporate actions to check,
 * holdings with no price, and daily prices that stopped coming (per currency held). None: [].
 */
export function attentionItems(i: {
  today: string;
  uncategorised: { count: number; latestMonth: string | null } | null;
  holdings: Holding[];
  /** the family has daily prices switched on */
  pricesOn: boolean;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  const u = i.uncategorised;
  if (u && u.count > 0)
    items.push({
      key: 'uncategorised',
      text: `${plural(u.count, 'payment or income', 'payments or income')} without a category`,
      // the newest of them: the list steps back month by month from there
      link: `/transactions?categoryId=none${u.latestMonth ? `&month=${u.latestMonth}` : ''}`,
    });
  const check = recentActions(i.holdings, i.today).filter(
    (r) =>
      daysBetween(r.action.exDate, i.today) <= NEW_DAYS && actionText(r.holding, r.action).check,
  );
  if (check.length)
    items.push({
      key: 'actions',
      text: `${plural(check.length, 'new corporate action', 'new corporate actions')} to check: ${some(
        [...new Set(check.map((r) => label(r.holding)))],
      )}`,
      link: '/investments/market',
    });
  const open = i.holdings.filter((h) => !h.archived && Number(h.units) > 0);
  const unpriced = open.filter((h) => h.price === null);
  if (unpriced.length)
    items.push({
      key: 'unpriced',
      text: `No price yet: ${some(unpriced.map(label))}`,
      link: '/investments/market?tab=holdings',
    });
  if (i.pricesOn) {
    for (const currency of [...new Set(open.map((h) => h.currency))]) {
      const latest = open
        .filter((h) => h.currency === currency && h.priceDate)
        .map((h) => h.priceDate!)
        .sort()
        .at(-1);
      if (latest && daysBetween(latest, i.today) > STALE_DAYS)
        items.push({
          key: `stale-${currency}`,
          text: `Prices of your ${currency === 'INR' ? 'Indian' : currency} holdings last updated ${dayLabel(latest)}`,
          link: '/investments/market',
        });
    }
  }
  return items;
}
