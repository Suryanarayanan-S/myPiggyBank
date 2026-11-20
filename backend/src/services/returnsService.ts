import type { PrismaClient } from '@prisma/client';
import { convert } from '../domain/currency.js';
import { summarise, type Flow, type Flows, type Summary } from '../domain/returns.js';
import { todayLocal } from '../lib/dates.js';
import { depositFlows } from './depositService.js';
import { getFamily } from './familyService.js';
import { goldFlows } from './goldService.js';
import { holdingFlows } from './holdingService.js';
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
