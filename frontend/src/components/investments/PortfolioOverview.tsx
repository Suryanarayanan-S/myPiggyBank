import clsx from 'clsx';
import { Card } from '../ui/Card';
import { gainClass, signed, type Holding } from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import {
  ACCOUNT,
  CAP,
  SECTOR,
  allocation,
  contributors,
  ranked,
  type RankedHolding,
} from '../../lib/portfolio';
import { AllocationDonut } from './AllocationDonut';
import { ValueOverTime } from './ValueOverTime';

const COLUMNS: Record<number, string> = { 1: '', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3' };

/** A Console-style overview: what weighs most, what moved most, and the value over time. */
export function PortfolioOverview({
  holdings,
  currency,
  onOpen,
}: {
  holdings: Holding[];
  currency: string;
  onOpen: (id: string) => void;
}) {
  const top = ranked(holdings, currency).slice(0, 10);
  const { performers, decliners } = contributors(holdings, 5);
  // A one-slice donut says nothing: only splits with at least two groups are drawn.
  const donuts = [ACCOUNT, SECTOR, CAP].filter((g) => allocation(holdings, g).length >= 2);
  return (
    <div className="space-y-5">
      {donuts.length > 0 && (
        <div className={clsx('grid gap-5', COLUMNS[donuts.length])}>
          {donuts.map((g) => (
            <AllocationDonut
              key={g.title}
              holdings={holdings}
              grouping={g}
              currency={currency}
              subtitle={g === CAP ? 'Shares only, by SEBI size group' : undefined}
            />
          ))}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Biggest holdings">
          {top.length === 0 && (
            <p className="text-sm text-slate-500">
              Nothing to compare yet in {currency} (add an exchange rate or a trade).
            </p>
          )}
          <ol className="space-y-2.5 empty:hidden">
            {top.map((r) => (
              <li key={r.holding.id}>
                <div className="mb-1 flex justify-between gap-3 text-sm">
                  <button
                    type="button"
                    className="min-w-0 truncate text-left hover:underline"
                    onClick={() => onOpen(r.holding.id)}
                  >
                    {r.holding.name}
                  </button>
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(r.value, currency)}{' '}
                    <span className="text-slate-500">{formatPercent(r.weightBp)}</span>
                  </span>
                </div>
                <div aria-hidden className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(top[0]!.weightBp ?? 0) > 0 ? ((r.weightBp ?? 0) / top[0]!.weightBp!) * 100 : 0}%`,
                      background: 'var(--c-single)',
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Contributors to returns">
          <div className="grid gap-5 sm:grid-cols-2">
            <Contributors
              title="Top performers"
              list={performers}
              currency={currency}
              onOpen={onOpen}
            />
            <Contributors
              title="Top decliners"
              list={decliners}
              currency={currency}
              onOpen={onOpen}
            />
          </div>
        </Card>
      </div>
      <ValueOverTime holdings={holdings} />
    </div>
  );
}

function Contributors({
  title,
  list,
  currency,
  onOpen,
}: {
  title: string;
  list: (RankedHolding & { pnl: number })[];
  currency: string;
  onOpen: (id: string) => void;
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-sm font-medium text-slate-500">{title}</h3>
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">None</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {list.map((r) => (
            <li key={r.holding.id} className="flex items-baseline justify-between gap-3">
              <button
                type="button"
                className="min-w-0 truncate text-left hover:underline"
                onClick={() => onOpen(r.holding.id)}
              >
                {r.holding.name}
              </button>
              <span className={clsx('shrink-0 text-right tabular-nums', gainClass(r.pnl))}>
                {signed(r.pnl, currency)}
                <span className="block text-xs">
                  {r.holding.returnBp === null ? '' : formatPercent(r.holding.returnBp)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
