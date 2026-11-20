import { useState } from 'react';
import clsx from 'clsx';
import { Card } from '../ui/Card';
import { FormError } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { gainClass, signed } from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import {
  PART_LABEL,
  byName,
  leftOutNotes,
  signedPercent,
  useReturns,
  type ReturnLine,
  type ReturnPart,
  type ReturnSummary,
} from '../../lib/returns';

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

type Shown = { part: ReturnPart; income: boolean };

const sinceLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Every kind of investment on one yardstick: what went in, what came back, what it is worth,
 * the gain and the yearly rate (XIRR) — so a deposit's 7 % can be set against the market's.
 */
export function Returns() {
  const q = useReturns();
  const [shown, setShown] = useState<Shown | null>(null);
  if (q.error) return <FormError error={q.error} />;
  const r = q.data;
  if (!r) return null;
  const c = r.currency;
  // Nothing in the view currency: say what was set aside rather than vanish.
  if (r.parts.length === 0 || !r.total) {
    if (r.unconverted.length === 0) return null;
    return (
      <Card title="Returns">
        <p className="text-sm text-amber-700 dark:text-amber-400">
          No exchange rate to {c} for{' '}
          {r.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')} — choose that
          currency under “Show in”, or add a rate in Settings.
        </p>
      </Card>
    );
  }
  // the bars of the yearly rate share one scale
  const widest = Math.max(1, ...[...r.parts, r.total].map((p) => Math.abs(p.xirrBp ?? 0)));
  const notes = leftOutNotes(r);

  /** An amount that opens the payments it is made of (the "All together" row stays plain). */
  const opens = (amount: number, part: ReturnPart | null, income: boolean) =>
    amount <= 0 ? (
      '—'
    ) : part === null ? (
      formatMoney(amount, c)
    ) : (
      <button
        type="button"
        onClick={() => setShown({ part, income })}
        aria-label={`${formatMoney(amount, c)} — show the ${
          income ? 'dividends and interest' : 'money back out'
        } of ${PART_LABEL[part]}`}
        className="tabular-nums underline decoration-slate-300 decoration-dotted underline-offset-4 hover:text-indigo-700 hover:decoration-indigo-500 dark:decoration-slate-600 dark:hover:text-indigo-300"
      >
        {formatMoney(amount, c)}
      </button>
    );

  const cells = (p: ReturnSummary, strong = false, part: ReturnPart | null = null) => (
    <>
      <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
        {formatMoney(p.putIn, c)}
      </td>
      <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
        {opens(p.takenOut, part, false)}
      </td>
      <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
        {opens(p.income, part, true)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.worth, c)}</td>
      <td className={clsx('px-3 py-2 text-right tabular-nums', gainClass(p.gain))}>
        {signed(p.gain, c)}
        <span className="block text-xs">{signedPercent(p.gainBp)}</span>
      </td>
      <td className="py-2 pr-4 pl-3 text-right">
        <span
          className={clsx('tabular-nums', strong && 'font-semibold', gainClass(p.xirrBp))}
          title={p.short ? 'Shown once held three months' : undefined}
        >
          {signedPercent(p.xirrBp)}
        </span>
        <span
          aria-hidden
          className="mt-1 ml-auto block h-1.5 w-20 rounded-full bg-slate-100 dark:bg-slate-800"
        >
          {p.xirrBp !== null && p.xirrBp !== 0 && (
            <span
              className={clsx(
                'block h-full rounded-full',
                p.xirrBp > 0 ? 'bg-emerald-500' : 'bg-rose-500',
              )}
              style={{ width: `${(Math.abs(p.xirrBp) / widest) * 100}%` }}
            />
          )}
        </span>
      </td>
    </>
  );

  return (
    <Card className="!p-0">
      <h2 className="px-5 pt-5 text-base font-semibold">Returns</h2>
      <p className="mt-1 px-5 pb-3 text-sm text-slate-500">
        What each kind has earned, on one yardstick: the gain on what went in, and the yearly rate
        (XIRR) — which counts when each amount went in and came back, so a deposit’s interest rate
        and the market can be compared.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Returns of each kind of investment, in {c}</caption>
          <thead>
            <tr className="border-y border-slate-200 text-xs text-slate-500 dark:border-slate-800">
              <th scope="col" className="py-2 pr-3 pl-4 text-left font-medium">
                Kind
              </th>
              <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                Put in
              </th>
              <th scope="col" className="hidden px-3 py-2 text-right font-medium md:table-cell">
                Back out
              </th>
              <th scope="col" className="hidden px-3 py-2 text-right font-medium md:table-cell">
                Dividends &amp; interest
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Worth today
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Gain
              </th>
              <th scope="col" className="py-2 pr-4 pl-3 text-right font-medium">
                A year
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {r.parts.map((p) => (
              <tr key={p.part}>
                <th scope="row" className="py-2 pr-3 pl-4 text-left font-normal">
                  {PART_LABEL[p.part]}
                  {p.since && (
                    <span className="block text-xs text-slate-500">
                      since {sinceLabel(p.since)}
                    </span>
                  )}
                </th>
                {cells(p, false, p.part)}
              </tr>
            ))}
          </tbody>
          {r.parts.length > 1 && (
            <tfoot>
              <tr className="border-t border-slate-200 font-medium dark:border-slate-800">
                <th scope="row" className="py-2 pr-3 pl-4 text-left">
                  All together
                </th>
                {cells(r.total, true)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <ul className="space-y-1 px-5 py-3 text-xs text-slate-500">
        <li>
          Open an amount under “Back out” or “Dividends &amp; interest” to see the payments it is
          made of. “Back out” is your money coming back: sales (after fees), withdrawals and
          deposits paid out. Dividends and interest paid out are earned on top. The gain counts
          both, and what is held today; splits and bonus issues pay nothing, they show in what it is
          worth. The yearly rate shows from three months on. Amounts in other currencies are
          converted at today’s rates.
        </li>
        {notes.length > 0 && <li>Not counted: {notes.join('; ')}.</li>}
        {r.unconverted.length > 0 && (
          <li className="text-amber-700 dark:text-amber-400">
            Not counted (no exchange rate to {c}):{' '}
            {r.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
          </li>
        )}
      </ul>
      {shown && (
        <Payments
          title={`${shown.income ? 'Dividends & interest' : 'Back out'} · ${PART_LABEL[shown.part]}`}
          currency={c}
          income={shown.income}
          lines={(r.parts.find((p) => p.part === shown.part)?.lines ?? []).filter(
            (l) => l.income === shown.income,
          )}
          onClose={() => setShown(null)}
        />
      )}
    </Card>
  );
}

/** The payments behind one figure: totals per holding or deposit first, then each one by date. */
function Payments({
  title,
  currency,
  income,
  lines,
  onClose,
}: {
  title: string;
  currency: string;
  income: boolean;
  lines: ReturnLine[];
  onClose: () => void;
}) {
  const total = lines.reduce((t, l) => t + l.amount, 0);
  const names = byName(lines);
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-slate-500">
        {income
          ? 'Dividends and interest paid out to you — earned on top of what you put in.'
          : 'Your money coming back: sales (after fees), withdrawals and deposits paid out.'}{' '}
        {lines.length} {lines.length === 1 ? 'payment' : 'payments'},{' '}
        <span className="font-medium text-slate-700 tabular-nums dark:text-slate-200">
          {formatMoney(total, currency)}
        </span>
        .
      </p>
      {names.length > 1 && (
        <section className="mt-4">
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            By {income ? 'payer' : 'holding or deposit'}
          </h3>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {names.map((n) => (
              <li key={n.name} className="flex justify-between gap-3 py-1.5">
                <span>
                  {n.name}
                  {n.count > 1 && <span className="text-slate-500"> · {n.count}×</span>}
                </span>
                <span className="tabular-nums">{formatMoney(n.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="mt-4">
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Each payment
        </h3>
        <table className="w-full text-sm">
          <caption className="sr-only">{title}, newest first</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Date</th>
              <th scope="col">From</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500 tabular-nums">
                  {dayLabel(l.date)}
                </td>
                <td className="w-full py-1.5 pr-3">{l.name}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatMoney(l.amount, currency)}
                  {l.own && (
                    <span className="block text-xs text-slate-500">
                      {formatMoney(l.own.amount, l.own.currency)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Modal>
  );
}
