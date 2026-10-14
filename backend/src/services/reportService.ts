import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CurrencySchema } from '../domain/currency.js';
import { yearReport } from '../domain/report.js';
import { todayLocal } from '../lib/dates.js';
import { getDashboard } from './dashboardService.js';
import { BOM, cell, csvAmount } from './exportService.js';
import { getNetWorth } from './wealthService.js';

export const YearParams = z.object({
  year: z
    .string()
    .regex(/^\d{4}$/, 'Use a year like 2026')
    .transform(Number)
    .pipe(z.number().min(1900).max(2100)),
});
export const ReportQuery = z.object({ currency: CurrencySchema.optional() });

/** One year next to the year before, in one currency (default: the spending currency). */
export async function getYearReport(
  prisma: PrismaClient,
  familyId: string,
  year: number,
  view?: string,
) {
  const [current, previous] = await Promise.all([
    getDashboard(prisma, familyId, `${year}-01`, `${year}-12`, view),
    getDashboard(prisma, familyId, `${year - 1}-01`, `${year - 1}-12`, view),
  ]);
  const currency = current.currency;
  const { snapshots } = await getNetWorth(prisma, familyId, currency);
  const first = `${year}-01-01`;
  const last = `${year}-12-31` < todayLocal() ? `${year}-12-31` : todayLocal();
  // Start: the last snapshot before the year (else the first in it); end: the last in it. One
  // that cannot be shown in this currency counts as missing, never as another currency.
  const startSnap =
    [...snapshots].reverse().find((s) => s.date < first) ??
    snapshots.find((s) => s.date >= first && s.date <= last);
  const endSnap = [...snapshots].reverse().find((s) => s.date >= first && s.date <= last);
  const point = (s: (typeof snapshots)[number] | undefined) =>
    s && s.currency === currency ? { date: s.date, amount: s.netWorth } : null;
  return {
    year,
    currency,
    ...yearReport(current, previous),
    netWorth: { start: point(startSnap), end: point(endSnap) },
    unconverted: current.unconverted,
  };
}

const pct = (bp: number | null) =>
  bp === null ? '' : `${(bp / 100).toFixed(1).replace('.', ',')} %`;

/** The report as a spreadsheet: months, then categories and people against last year. */
export function reportCsv(r: Awaited<ReturnType<typeof getYearReport>>) {
  const BUCKET: Record<string, string> = {
    essentials: 'Essentials',
    fun: 'Fun',
    future: 'Future You',
  };
  const row = (cells: string[]) => cells.join(';');
  const money = (m: (typeof r)['totals']) => [
    csvAmount(m.netIncome),
    csvAmount(m.essentials),
    csvAmount(m.fun),
    csvAmount(m.future),
    csvAmount(m.unused),
    pct(m.savingsRateBp),
  ];
  const lines = [
    row(['Month', 'Net income', 'Essentials', 'Fun', 'Future You', 'Unused', 'Savings rate']),
    ...r.months.filter((m) => m.recorded).map((m) => row([m.month, ...money(m)])),
    row([`Total ${r.year}`, ...money(r.totals)]),
    ...(r.previous ? [row([`Total ${r.year - 1}`, ...money(r.previous.totals)])] : []),
    '',
    row(['Category', 'Bucket', String(r.year), String(r.year - 1), 'Change']),
    ...r.categories.map((c) =>
      row([
        cell(c.name),
        c.bucket ? BUCKET[c.bucket]! : '',
        csvAmount(c.actual),
        csvAmount(c.previous),
        pct(c.changeBp),
      ]),
    ),
    '',
    row(['Spent by', String(r.year), String(r.year - 1), 'Change']),
    ...r.members.map((m) =>
      row([cell(m.name), csvAmount(m.actual), csvAmount(m.previous), pct(m.changeBp)]),
    ),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
