import type { PrismaClient } from '@prisma/client';
import { convert, type Rate } from '../domain/currency.js';
import { dayGrid, rangeStart, type Range } from '../domain/history.js';
import { formatDay } from '../lib/dates.js';
import { accountBalanceSelect, balancesOn } from './accountService.js';
import { depositSeries } from './depositService.js';
import { goldSeries } from './goldService.js';
import { holdingSeries } from './holdingService.js';
import { firstInvested } from './returnsService.js';

/**
 * Net worth on any day, worked out like today's from what the app knows — nothing to save:
 * the accounts from their transactions, market holdings at that day's prices, deposits from
 * their terms, gold at that day's rate, assets at their latest valuation and loans at their
 * latest balance on or before the day. An asset or loan is taken to have been there at its first
 * known value before that (a house entered today was not bought today). Other currencies at
 * today's rates, as the investment history.
 */

/** The first day the app has money moving (the first transaction or investment, up to today);
 *  null with none. */
export async function dataStart(prisma: PrismaClient, familyId: string, today: string) {
  const [t, invested] = await Promise.all([
    prisma.transaction.aggregate({ where: { familyId }, _min: { date: true } }),
    firstInvested(prisma, familyId),
  ]);
  const days = [t._min.date ? formatDay(t._min.date) : null, invested]
    .filter((d): d is string => !!d && d <= today)
    .sort();
  return days[0] ?? null;
}

/** A dated value on each day (sorted): the latest on or before it, before the first the first. */
export function stepValues(points: { date: string; value: number }[], days: string[]) {
  // a stable sort: entries of the same day keep their order (the last entered wins)
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  let k = 0;
  return days.map((day) => {
    while (k + 1 < sorted.length && sorted[k + 1]!.date <= day) k++;
    return sorted[k]?.value ?? 0;
  });
}

/** Net worth at the end of each of `days` (sorted, the last at most today), in `currency`. */
export async function netWorthOn(
  prisma: PrismaClient,
  familyId: string,
  currency: string,
  days: string[],
  today: string,
  rates: Rate[],
  /** investments at what was put in, as the family chose net worth to count them */
  atCost = false,
) {
  const [accounts, txns, assets, liabilities, holdings, deposits, gold] = await Promise.all([
    // archived ones too: their money was there until it moved
    prisma.account.findMany({ where: { familyId } }),
    prisma.transaction.findMany({
      where: { familyId },
      select: accountBalanceSelect,
      orderBy: { date: 'asc' },
    }),
    prisma.asset.findMany({
      where: { familyId },
      include: { valuations: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] } },
    }),
    prisma.liability.findMany({
      where: { familyId },
      include: { balances: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] } },
    }),
    holdingSeries(prisma, familyId, days, { atCost, today }),
    depositSeries(prisma, familyId, days, { atCost }),
    goldSeries(prisma, familyId, days, { atCost }),
  ]);
  const month = today.slice(0, 7);
  const total = days.map(() => 0);
  const add = (from: string, values: number[], sign = 1) => {
    // one rate per currency: test it once; without one, left out (as today's total does)
    if (convert(1_000_000, from, currency, month, rates) === null) return;
    values.forEach((v, i) => {
      if (v !== 0) total[i]! += sign * convert(v, from, currency, month, rates)!;
    });
  };

  const balances = balancesOn(accounts, txns, days, today);
  for (const a of accounts) {
    const values = balances.get(a.id)!;
    // today an archived account counts as in today's total: not at all
    if (a.archived && days.at(-1) === today) values[values.length - 1] = 0;
    add(a.currency, values);
  }
  for (const a of assets)
    add(
      a.currency,
      stepValues(
        a.valuations.map((v) => ({ date: formatDay(v.date), value: Number(v.value) })),
        days,
      ),
    );
  for (const l of liabilities)
    add(
      l.currency,
      stepValues(
        l.balances.map((b) => ({ date: formatDay(b.date), value: Number(b.outstanding) })),
        days,
      ),
      -1,
    );
  for (const s of [...holdings, ...deposits, ...gold]) add(s.currency, s.values);
  return total;
}

/**
 * Net worth over a range ending today, day by day, ending at today's figure (`now`). For "all"
 * it starts on the first day money moved in the app; the past entries typed in from before then
 * (`earlier`, already in `currency`) lead up to it.
 */
export async function netWorthHistory(
  prisma: PrismaClient,
  familyId: string,
  currency: string,
  range: Range,
  today: string,
  rates: Rate[],
  now: number,
  past: { date: string; netWorth: number; currency: string }[],
  atCost = false,
) {
  const first = await dataStart(prisma, familyId, today);
  const start = rangeStart(range, today, first);
  // nothing before the first day the app knows about: its past entries say that part
  const days = dayGrid(first && first > start ? first : start, today);
  const total = await netWorthOn(prisma, familyId, currency, days, today, rates, atCost);
  total[total.length - 1] = now;
  const entries = past
    .filter((p) => p.currency === currency)
    .sort((a, b) => a.date.localeCompare(b.date));
  // "all": every one before the first day; a shorter range: those inside it, and the last one
  // before it starting the line on its first day
  const inside = entries.filter((p) => (range === 'all' || p.date >= start) && p.date < days[0]!);
  const before = range === 'all' ? undefined : entries.filter((p) => p.date < start).at(-1);
  const earlier = [
    ...(before && start < days[0]! ? [{ date: start, netWorth: before.netWorth }] : []),
    ...inside,
  ].map((p) => ({ date: p.date, value: p.netWorth }));
  return { currency, days, total, earlier };
}

/**
 * Net worth on a few days: worked out from the first day the app knows about; before that the
 * latest past entry on or before the day, with its own date (null without one).
 */
export async function netWorthAt(
  prisma: PrismaClient,
  familyId: string,
  currency: string,
  dates: string[],
  today: string,
  rates: Rate[],
  past: { date: string; netWorth: number; currency: string }[],
  atCost = false,
) {
  const first = await dataStart(prisma, familyId, today);
  const known = [
    ...new Set(dates.filter((d) => first !== null && d >= first && d <= today)),
  ].sort();
  const values = known.length
    ? await netWorthOn(prisma, familyId, currency, known, today, rates, atCost)
    : [];
  const computed = new Map(known.map((d, i) => [d, values[i]!]));
  const entries = [...past].sort((a, b) => a.date.localeCompare(b.date));
  return dates.map((d) => {
    if (computed.has(d)) return { date: d, netWorth: computed.get(d)! };
    // the nearest one counts; one that cannot be shown in this currency means no figure (never
    // quietly an older one instead)
    const entry = [...entries].reverse().find((p) => p.date <= d);
    return entry && entry.currency === currency
      ? { date: entry.date, netWorth: entry.netWorth }
      : null;
  });
}
