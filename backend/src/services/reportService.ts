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
  // A month is recorded when it has any income or expense — even one without an exchange rate
  // (it is then listed as unconverted). Months after this one do not count yet.
  const thisMonth = todayLocal().slice(0, 7);
  const rows = await prisma.transaction.findMany({
    where: {
      familyId,
      type: { in: ['income', 'expense'] },
      date: { gte: new Date(`${year - 1}-01-01`), lt: new Date(`${year + 1}-01-01`) },
    },
    select: { date: true },
  });
  const months = new Set(
    rows.map((t) => t.date.toISOString().slice(0, 7)).filter((m) => m <= thisMonth),
  );
  const recorded = new Set([...months].filter((m) => m.startsWith(`${year}-`)));
  const lastRecorded = [...recorded].sort().at(-1);
  // Like for like: last year up to the same month as the last one recorded this year, so a
  // year in progress is never compared with a whole year.
  const through = `${year - 1}-${lastRecorded ? lastRecorded.slice(5) : '12'}`;
  const [current, previous] = await Promise.all([
    getDashboard(prisma, familyId, `${year}-01`, `${year}-12`, view),
    getDashboard(prisma, familyId, `${year - 1}-01`, through, view),
  ]);
  const report = yearReport(current, previous, {
    recorded,
    previousRecorded: new Set([...months].filter((m) => m.startsWith(`${year - 1}-`))),
  });
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
  // One snapshot is a point, not a change: show it as the end only.
  const start = startSnap === endSnap ? undefined : startSnap;
  const point = (s: (typeof snapshots)[number] | undefined) =>
    s && s.currency === currency ? { date: s.date, amount: s.netWorth } : null;
  return {
    year,
    currency,
    ...report,
    previous: report.previous && {
      ...report.previous,
      through,
      label: periodLabel(through),
      unconverted: previous.unconverted,
    },
    netWorth: { start: point(start), end: point(endSnap) },
    unconverted: current.unconverted,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2025", "Jan 2025" or "Jan–Sep 2025" for the months compared. */
function periodLabel(through: string) {
  const [y, m] = [through.slice(0, 4), Number(through.slice(5))];
  return m === 12 ? y : m === 1 ? `Jan ${y}` : `Jan–${MONTHS[m - 1]} ${y}`;
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
    csvAmount(m.uncategorised),
    csvAmount(m.unused),
    pct(m.savingsRateBp),
  ];
  const before = r.previous?.label;
  const missing = (list: { currency: string; amount: number }[], what: string) =>
    list.map((u) => row([`Not converted (${what})`, u.currency, csvAmount(u.amount)]));
  const lines = [
    row(['Currency', r.currency]),
    row([
      'Month',
      'Net income',
      'Essentials',
      'Fun',
      'Future You',
      'Uncategorised',
      'Unused',
      'Savings rate',
    ]),
    ...r.months.filter((m) => m.recorded).map((m) => row([m.month, ...money(m)])),
    row([`Total ${r.year}`, ...money(r.totals)]),
    ...(r.previous ? [row([`Total ${before}`, ...money(r.previous.totals)])] : []),
    ...(r.previous && r.changeBasis === 'average'
      ? [row(['Changes compare monthly averages (a different number of months was recorded)'])]
      : []),
    ...missing(r.unconverted, String(r.year)),
    ...(r.previous ? missing(r.previous.unconverted, before!) : []),
    '',
    row(['Category', 'Bucket', String(r.year), ...(before ? [before, 'Change'] : [])]),
    ...r.categories.map((c) =>
      row([
        cell(c.name),
        c.bucket ? BUCKET[c.bucket]! : '',
        csvAmount(c.actual),
        ...(before ? [csvAmount(c.previous), pct(c.changeBp)] : []),
      ]),
    ),
    '',
    row(['Spent by', String(r.year), ...(before ? [before, 'Change'] : [])]),
    ...r.members.map((m) =>
      row([
        cell(m.name),
        csvAmount(m.actual),
        ...(before ? [csvAmount(m.previous), pct(m.changeBp)] : []),
      ]),
    ),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
