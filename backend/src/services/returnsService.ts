import type { PrismaClient } from '@prisma/client';
import { convert } from '../domain/currency.js';
import { summarise, type Flow, type Flows, type Summary } from '../domain/returns.js';
import { formatDay, todayLocal } from '../lib/dates.js';
import { dayGrid, rangeStart, type Range } from '../domain/history.js';
import { depositFlows, depositSeries } from './depositService.js';
import { getFamily } from './familyService.js';
import { goldFlows, goldSeries } from './goldService.js';
import { holdingFlows, holdingSeries } from './holdingService.js';
import { loadRates } from './rateService.js';

export const PARTS = ['market', 'fd', 'rd', 'savings', 'gold'] as const;
export type Part = (typeof PARTS)[number];

type Item = Flows & { name: string; currency: string };

/**
 * One payment behind "Back out" or "Dividends & interest": in the view currency, and in its own
 * when that differs.
 */
export type ReturnLine = {
  date: string;
  name: string;
  /** dividends and interest paid out (else money coming back: a sale, a withdrawal, a payout) */
  income: boolean;
  amount: number;
  own: { amount: number; currency: string } | null;
};

/**
 * Every kind of investment on one yardstick, in one currency (default: the wealth currency):
 * what went in, what came back, what is held today, the gain and the yearly rate (XIRR) — each
 * kind and all together. Past amounts are converted at today's rates, like the other totals, so
 * the rates leave out what the exchange rate did.
 */
export async function investmentReturns(
  prisma: PrismaClient,
  familyId: string,
  view?: string,
  today = todayLocal(),
) {
  const [family, rates, holdings, deposits, gold] = await Promise.all([
    getFamily(prisma, familyId),
    loadRates(prisma, familyId),
    holdingFlows(prisma, familyId, today),
    depositFlows(prisma, familyId, today),
    goldFlows(prisma, familyId, today),
  ]);
  const currency = view ?? family.wealthCurrency;
  const month = today.slice(0, 7);
  const unconverted = new Map<string, number>();

  /** The items in the view currency (those without an exchange rate are set aside). */
  const inView = (items: Item[]) => {
    const flows: Flow[] = [];
    const lines: ReturnLine[] = [];
    let worth = 0;
    let count = 0;
    for (const it of items) {
      const conv = (n: number) => (n === 0 ? 0 : convert(n, it.currency, currency, month, rates));
      const w = conv(it.worth);
      const fs = it.flows.map((f) => ({ ...f, amount: conv(f.amount) }));
      if (w === null || fs.some((f) => f.amount === null)) {
        // what is held, or (paid out, sold) what went in
        const amount = it.worth || it.flows.reduce((t, f) => t + Math.max(0, -f.amount), 0);
        unconverted.set(it.currency, (unconverted.get(it.currency) ?? 0) + amount);
        continue;
      }
      flows.push(...(fs as Flow[]));
      it.flows.forEach((f, i) => {
        if (f.amount <= 0) return;
        lines.push({
          date: f.date,
          name: it.name,
          income: !!f.income,
          amount: fs[i]!.amount!,
          own: it.currency === currency ? null : { amount: f.amount, currency: it.currency },
        });
      });
      worth += w;
      count++;
    }
    lines.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
    return { flows, worth, count, lines };
  };

  const items: Record<Part, Item[]> = {
    market: holdings.filter((h) => h.priced),
    fd: deposits.filter((d) => d.kind === 'fd'),
    rd: deposits.filter((d) => d.kind === 'rd'),
    savings: deposits.filter((d) => d.kind === 'savings'),
    gold: gold.counted,
  };
  const all: Flow[] = [];
  let allWorth = 0;
  const parts: (Summary & { part: Part; count: number; lines: ReturnLine[] })[] = [];
  for (const part of PARTS) {
    const v = inView(items[part].filter((i) => i.flows.length > 0));
    if (v.count === 0) continue;
    all.push(...v.flows);
    allWorth += v.worth;
    parts.push({ part, count: v.count, ...summarise(v.flows, v.worth, today), lines: v.lines });
  }
  return {
    currency,
    parts,
    total: parts.length > 0 ? summarise(all, allWorth, today) : null,
    /** held but not valued: holdings without any price; gold without a price paid or a rate */
    leftOut: {
      market: holdings.filter((h) => !h.priced).length,
      gold: gold.leftOut,
    },
    unconverted: [...unconverted].map(([c, amount]) => ({ currency: c, amount })),
  };
}

/** The first day anything was invested (for the "all" range); null with nothing. */
export async function firstInvested(prisma: PrismaClient, familyId: string) {
  const [t, d, g] = await Promise.all([
    prisma.holdingTrade.aggregate({ where: { holding: { familyId } }, _min: { date: true } }),
    prisma.deposit.aggregate({ where: { familyId }, _min: { startDate: true } }),
    prisma.goldItem.aggregate({ where: { familyId }, _min: { boughtOn: true } }),
  ]);
  const days = [t._min.date, d._min.startDate, g._min.boughtOn]
    .filter((x): x is Date => !!x)
    .map(formatDay)
    .sort();
  return days[0] ?? null;
}

/**
 * What everything invested was worth over a range (market holdings at their prices then,
 * deposits from their terms, gold at that day's rate), in one currency at today's rates like the
 * totals: all together, each kind, and each deposit. Amounts in a currency without a rate are
 * left out.
 */
export async function investmentHistory(
  prisma: PrismaClient,
  familyId: string,
  view?: string,
  range: Range = '1y',
  today = todayLocal(),
) {
  const first = range === 'all' ? await firstInvested(prisma, familyId) : null;
  const days = dayGrid(rangeStart(range, today, first), today);
  const [family, rates, holdings, deposits, gold] = await Promise.all([
    getFamily(prisma, familyId),
    loadRates(prisma, familyId),
    holdingSeries(prisma, familyId, days),
    depositSeries(prisma, familyId, days),
    goldSeries(prisma, familyId, days),
  ]);
  const currency = view ?? family.wealthCurrency;
  const month = today.slice(0, 7);
  /** In the view currency; null without a rate (one rate per currency, so test it once). */
  const inView = (s: { currency: string; values: number[] }) =>
    convert(1_000_000, s.currency, currency, month, rates) === null
      ? null
      : s.values.map((v) => (v === 0 ? 0 : convert(v, s.currency, currency, month, rates)!));
  const add = (into: number[], values: number[]) => values.forEach((v, i) => (into[i]! += v));
  const total = days.map(() => 0);
  const parts: Partial<Record<Part, number[]>> = {};
  const series: Record<Part, { currency: string; values: number[] }[]> = {
    market: holdings,
    fd: deposits.filter((d) => d.kind === 'fd'),
    rd: deposits.filter((d) => d.kind === 'rd'),
    savings: deposits.filter((d) => d.kind === 'savings'),
    gold,
  };
  for (const part of PARTS) {
    const sum = days.map(() => 0);
    let any = false;
    for (const s of series[part]) {
      const v = inView(s);
      if (!v) continue;
      add(sum, v);
      any ||= v.some((x) => x !== 0);
    }
    if (any) parts[part] = sum;
    add(total, sum);
  }
  return {
    currency,
    days,
    total,
    parts,
    /** each deposit, for its own small graph */
    deposits: deposits.flatMap((d) => {
      const v = inView(d);
      return v && v.some((x) => x !== 0) ? [{ id: d.id, values: v }] : [];
    }),
  };
}
