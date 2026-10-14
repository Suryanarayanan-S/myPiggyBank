import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';
import { formatPercent } from '../lib/percent';
import { BUCKETS } from '../lib/types';
import { useViewCurrency, withView } from '../lib/viewCurrency';

type Money = {
  netIncome: number;
  essentials: number;
  fun: number;
  future: number;
  uncategorised: number;
  spent: number;
  unused: number;
  savingsRateBp: number | null;
};
type Row = { name: string; actual: number; previous: number; changeBp: number | null };
type YearReport = {
  year: number;
  currency: string;
  months: (Money & { month: string; recorded: boolean })[];
  totals: Money;
  recordedMonths: number;
  averages: Money;
  previous: { totals: Money; recordedMonths: number; through: string } | null;
  change: Record<keyof Omit<Money, 'savingsRateBp'>, { amount: number; bp: number | null }>;
  categories: (Row & { categoryId: string | null; bucket: keyof typeof BUCKETS | null })[];
  members: (Row & { memberId: string | null })[];
  netWorth: {
    start: { date: string; amount: number } | null;
    end: { date: string; amount: number } | null;
  };
  unconverted: { currency: string; amount: number }[];
};

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

const shortMonth = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  });

const COLUMNS: { key: keyof Omit<Money, 'savingsRateBp'>; label: string }[] = [
  { key: 'netIncome', label: 'Net income' },
  { key: 'essentials', label: 'Essentials' },
  { key: 'fun', label: 'Fun' },
  { key: 'future', label: 'Future You' },
  { key: 'unused', label: 'Unused' },
];

/** A change in %, worded and coloured by whether up is good for that line. */
function Change({ bp, upIsGood = true }: { bp: number | null; upIsGood?: boolean }) {
  if (bp === null) return <span className="text-slate-400">—</span>;
  const good = bp === 0 ? null : bp > 0 === upIsGood;
  return (
    <span
      className={clsx(
        'tabular-nums',
        good === true && 'text-emerald-700 dark:text-emerald-400',
        good === false && 'text-rose-700 dark:text-rose-400',
      )}
    >
      {bp > 0 ? '+' : ''}
      {formatPercent(bp)}
    </span>
  );
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = /^\d{4}$/.test(params.get('year') ?? '') ? Number(params.get('year')) : thisYear;
  const [view] = useViewCurrency();
  const report = useQuery({
    queryKey: ['report', year, view],
    queryFn: () => api.get<YearReport>(withView(`/reports/year/${year}`, view)),
    placeholderData: keepPreviousData,
  });
  const r = report.data;
  const money = (c: number) => formatMoney(c, r?.currency);
  const go = (y: number) => setParams({ year: String(y) }, { replace: true });
  // "2025", or "Jan–Feb 2025" while this year is still in progress (like-for-like months).
  const prevLabel = !r?.previous
    ? ''
    : r.previous.through.endsWith('-12')
      ? String(year - 1)
      : `${r.previous.through.endsWith('-01') ? 'Jan' : `Jan–${shortMonth(r.previous.through)}`} ${year - 1}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            aria-label="Previous year"
            onClick={() => go(year - 1)}
            className="print:hidden"
          >
            <ChevronLeft size={18} aria-hidden />
          </Button>
          <h1 className="min-w-28 text-center text-2xl font-semibold tracking-tight">
            Year {year}
          </h1>
          <Button
            variant="ghost"
            aria-label="Next year"
            disabled={year >= thisYear}
            onClick={() => go(year + 1)}
            className="print:hidden"
          >
            <ChevronRight size={18} aria-hidden />
          </Button>
        </div>
        <div className="flex gap-2 print:hidden">
          <a
            href={`/api${withView(`/reports/year/${year}.csv`, view)}`}
            download
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download size={16} aria-hidden /> CSV
          </a>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={16} aria-hidden /> Print
          </Button>
        </div>
      </div>
      <FormError error={report.error} />

      {r && r.recordedMonths === 0 && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Nothing recorded in {year} yet.
          </p>
        </Card>
      )}

      {r && r.recordedMonths > 0 && (
        <>
          {r.unconverted.length > 0 && (
            <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              Left out (no exchange rate to {r.currency}):{' '}
              {r.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                ['Net income', r.totals.netIncome, 'netIncome', true],
                ['Spent', r.totals.spent, 'spent', false],
                ['Future You', r.totals.future, 'future', true],
              ] as const
            ).map(([label, value, key, up]) => (
              <Card key={label} className="!p-4">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{money(value)}</p>
                {r.previous && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    <Change bp={r.change[key].bp} upIsGood={up} /> vs {prevLabel}
                  </p>
                )}
              </Card>
            ))}
            <Card className="!p-4">
              <p className="text-xs text-slate-500">Savings rate</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatPercent(r.totals.savingsRateBp)}
              </p>
              {r.previous && (
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatPercent(r.previous.totals.savingsRateBp)} in {prevLabel}
                </p>
              )}
            </Card>
          </div>
          <p className="text-xs text-slate-500">
            {r.recordedMonths} of 12 months recorded
            {r.previous
              ? ` · compared with ${prevLabel} (the same months), where ${r.previous.recordedMonths} ${r.previous.recordedMonths === 1 ? 'month was' : 'months were'} recorded`
              : ` · nothing recorded in ${year - 1} to compare with`}
            .
          </p>

          <Card title="Month by month" className="max-w-full">
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-right text-xs text-slate-500 dark:border-slate-800">
                    <th className="py-2 text-left font-medium">Month</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="py-2 pl-3 font-medium">
                        {c.label}
                      </th>
                    ))}
                    <th className="py-2 pl-3 font-medium">Savings rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {r.months.map((m) => (
                    <tr
                      key={m.month}
                      className={clsx('text-right', !m.recorded && 'text-slate-400')}
                    >
                      <td className="py-1.5 text-left">{monthName(m.month)}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="py-1.5 pl-3 tabular-nums">
                          {m.recorded ? money(m[c.key]) : '—'}
                        </td>
                      ))}
                      <td className="py-1.5 pl-3 tabular-nums">
                        {m.recorded ? formatPercent(m.savingsRateBp) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 text-right dark:border-slate-700">
                  <tr className="font-semibold">
                    <td className="py-1.5 text-left">Total</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="py-1.5 pl-3 tabular-nums">
                        {money(r.totals[c.key])}
                      </td>
                    ))}
                    <td className="py-1.5 pl-3 tabular-nums">
                      {formatPercent(r.totals.savingsRateBp)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-left text-slate-500">Average month</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="py-1.5 pl-3 tabular-nums">
                        {money(r.averages[c.key])}
                      </td>
                    ))}
                    <td />
                  </tr>
                  {r.previous && (
                    <>
                      <tr>
                        <td className="py-1.5 text-left text-slate-500">{prevLabel}</td>
                        {COLUMNS.map((c) => (
                          <td key={c.key} className="py-1.5 pl-3 tabular-nums">
                            {money(r.previous!.totals[c.key])}
                          </td>
                        ))}
                        <td className="py-1.5 pl-3 tabular-nums">
                          {formatPercent(r.previous.totals.savingsRateBp)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-left text-slate-500">Change</td>
                        {COLUMNS.map((c) => (
                          <td key={c.key} className="py-1.5 pl-3">
                            <Change
                              bp={r.change[c.key].bp}
                              upIsGood={c.key !== 'essentials' && c.key !== 'fun'}
                            />
                          </td>
                        ))}
                        <td />
                      </tr>
                    </>
                  )}
                </tfoot>
              </table>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <CompareTable
              title="Spending by category"
              first="Category"
              year={year}
              previousLabel={prevLabel || String(year - 1)}
              money={money}
              rows={r.categories.map((c) => ({
                key: c.categoryId ?? 'none',
                name: c.name,
                note: c.bucket ? BUCKETS[c.bucket] : undefined,
                actual: c.actual,
                previous: c.previous,
                changeBp: c.changeBp,
                upIsGood: c.bucket === 'future',
              }))}
            />
            <div className="space-y-5">
              <CompareTable
                title="Spent by"
                first="Person"
                year={year}
                previousLabel={prevLabel || String(year - 1)}
                money={money}
                rows={r.members.map((m) => ({
                  key: m.memberId ?? 'shared',
                  name: m.name,
                  actual: m.actual,
                  previous: m.previous,
                  changeBp: m.changeBp,
                  upIsGood: false,
                }))}
              />
              <Card title="Net worth">
                {r.netWorth.start || r.netWorth.end ? (
                  <dl className="space-y-2 text-sm">
                    {[r.netWorth.start, r.netWorth.end].map(
                      (p, i) =>
                        p && (
                          <div key={i} className="flex justify-between gap-3">
                            <dt className="text-slate-500">
                              {i === 0 ? 'Start' : 'End'} · {p.date}
                            </dt>
                            <dd className="font-medium tabular-nums">{money(p.amount)}</dd>
                          </div>
                        ),
                    )}
                    {r.netWorth.start && r.netWorth.end && (
                      <div className="flex justify-between gap-3 border-t border-slate-100 pt-2 dark:border-slate-800">
                        <dt className="text-slate-500">Change</dt>
                        <dd className="font-semibold tabular-nums">
                          {money(r.netWorth.end.amount - r.netWorth.start.amount)}
                        </dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="text-sm text-slate-500">
                    No net-worth snapshots for {year} in {r.currency}.
                  </p>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CompareTable({
  title,
  first,
  year,
  previousLabel,
  money,
  rows,
}: {
  title: string;
  first: string;
  year: number;
  previousLabel: string;
  money: (c: number) => string;
  rows: {
    key: string;
    name: string;
    note?: string;
    actual: number;
    previous: number;
    changeBp: number | null;
    upIsGood: boolean;
  }[];
}) {
  return (
    <Card title={title} className="max-w-full">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing yet.</p>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-right text-xs text-slate-500 dark:border-slate-800">
                <th className="py-2 text-left font-medium">{first}</th>
                <th className="py-2 pl-3 font-medium">{year}</th>
                <th className="py-2 pl-3 font-medium">{previousLabel}</th>
                <th className="py-2 pl-3 font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <tr key={r.key} className="text-right">
                  <td className="py-1.5 text-left">
                    {r.name}
                    {r.note && <span className="ml-1 text-xs text-slate-400">{r.note}</span>}
                  </td>
                  <td className="py-1.5 pl-3 tabular-nums">{money(r.actual)}</td>
                  <td className="py-1.5 pl-3 text-slate-500 tabular-nums">{money(r.previous)}</td>
                  <td className="py-1.5 pl-3">
                    <Change bp={r.changeBp} upIsGood={r.upIsGood} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
