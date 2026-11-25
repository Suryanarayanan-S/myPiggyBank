import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router';
import { ValueChart } from '../components/charts/ValueChart';
import { Returns } from '../components/investments/Returns';
import { useInvestmentHistory, useRange, type InvestmentPart } from '../lib/history';
import { InvestmentMix } from '../components/investments/InvestmentMix';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { api } from '../lib/api';
import { dayLabel, maturingSoon, useDeposits, whenLeft, type Deposit } from '../lib/deposits';
import { useGold } from '../lib/gold';
import type { HoldingsResponse } from '../lib/investments';
import { formatMoney } from '../lib/money';
import { useViewCurrency, withView } from '../lib/viewCurrency';
import { useMe } from '../auth/auth';

/** Everything invested at a glance: market holdings and deposits, and what matures soon. */
export function InvestmentsOverviewPage() {
  const [params] = useSearchParams();
  const me = useMe();
  // Net worth may count investments at what was put in; these totals are always worth today.
  const atCost = me.data?.family.investmentsAt === 'invested';
  const [view] = useViewCurrency();
  const holdings = useQuery({
    queryKey: ['holdings', view],
    queryFn: () => api.get<HoldingsResponse>(withView('/holdings', view)),
  });
  const deposits = useDeposits();
  const gold = useGold();
  const [range, setRange] = useRange();
  const history = useInvestmentHistory(range);
  const h = history.data;
  // The holdings list used to live here (…/investments?tab=holdings).
  if (params.get('tab') === 'holdings')
    return <Navigate to="/investments/market?tab=holdings" replace />;
  const market = holdings.data?.summary;
  // each kind of deposit on its own (in the summary currency)
  const inView = (kind: Deposit['kind']) =>
    (deposits.data?.deposits ?? [])
      .filter((d) => d.kind === kind)
      .reduce((t, d) => t + (d.inView?.value ?? 0), 0);
  const dep = deposits.data?.summary;
  const currency = market?.currency ?? dep?.currency ?? 'INR';
  const open = (kind: Deposit['kind']) =>
    (deposits.data?.deposits ?? []).some((d) => d.kind === kind && d.status !== 'closed');
  const parts = [
    {
      key: 'market' as InvestmentPart,
      color: 'var(--c-cat-1)',
      to: '/investments/market',
      label: 'Market (shares, funds, ETFs)',
      short: 'Market',
      value: market?.value ?? 0,
      has: (holdings.data?.holdings ?? []).some((h) => !h.archived),
    },
    {
      key: 'fd' as InvestmentPart,
      color: 'var(--c-cat-3)',
      to: '/investments/deposits',
      label: 'Fixed deposits',
      value: inView('fd'),
      has: open('fd'),
    },
    {
      key: 'rd' as InvestmentPart,
      color: 'var(--c-cat-7)',
      to: '/investments/deposits',
      label: 'Recurring deposits',
      value: inView('rd'),
      has: open('rd'),
    },
    {
      key: 'savings' as InvestmentPart,
      color: 'var(--c-cat-5)',
      to: '/investments/deposits',
      label: 'Instant-access savings',
      value: inView('savings'),
      has: open('savings'),
    },
    {
      key: 'gold' as InvestmentPart,
      color: 'var(--c-cat-4)',
      to: '/investments/gold',
      label: 'Gold (jewellery, coins)',
      short: 'Gold',
      value: gold.data?.summary.value ?? 0,
      has: (gold.data?.items ?? []).some((g) => g.status === 'held'),
      hint: !gold.data?.rate
        ? 'no gold rate yet'
        : gold.data.rate.stale
          ? `at the rate of ${dayLabel(gold.data.rate.date)}`
          : undefined,
    },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  const soon = maturingSoon(deposits.data?.deposits ?? []);
  const unconverted = [
    ...(market?.unconverted ?? []),
    ...(dep?.unconverted ?? []),
    ...(gold.data?.summary.unconverted ?? []),
  ];
  const loaded = holdings.data && deposits.data && gold.data;
  // Something is invested even when it cannot be added up (no exchange rate): not "nothing".
  const anything =
    total > 0 ||
    unconverted.length > 0 ||
    (holdings.data?.holdings.some((h) => !h.archived) ?? false) ||
    (deposits.data?.deposits.some((d) => d.status !== 'closed') ?? false) ||
    parts.some((p) => p.has);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Investments</h1>
        <p className="text-sm text-slate-500">
          Everything invested, together: market holdings, deposits and gold. They count in net worth
          as investments.
        </p>
      </div>
      <FormError error={holdings.error ?? deposits.error ?? gold.error} />
      {loaded && !anything && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Nothing invested yet. Add shares, ETFs and funds under{' '}
            <Link to="/investments/market" className="font-medium text-indigo-600 underline">
              Market
            </Link>{' '}
            (or import them from Zerodha), and fixed and recurring deposits under{' '}
            <Link to="/investments/deposits" className="font-medium text-indigo-600 underline">
              Deposits
            </Link>
            , and jewellery and coins under{' '}
            <Link to="/investments/gold" className="font-medium text-indigo-600 underline">
              Gold
            </Link>
            .
          </p>
        </Card>
      )}
      {loaded && anything && (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <InvestmentMix
              currency={currency}
              rows={parts
                .filter((p) => p.has || p.value > 0)
                .map((p) => ({
                  key: p.key,
                  label: ('short' in p && p.short) || p.label,
                  title: p.label,
                  value: p.value,
                  color: p.color,
                  to: p.to,
                  hint: 'hint' in p ? p.hint : undefined,
                  line: h?.currency === currency ? h.parts[p.key] : undefined,
                }))}
            />
            {h && h.currency === currency && (
              <ValueChart
                title="Everything invested"
                className="flex min-w-0 flex-col"
                height={260}
                points={h.days.map((date, i) => ({ date, value: h.total[i]! }))}
                currency={currency}
                range={range}
                onRange={setRange}
                note="Market holdings at their prices then, deposits from their terms, gold at that day’s rate — other currencies at today’s rates."
              />
            )}
          </div>
          {atCost && (
            <p className="text-xs text-slate-500">
              These are worth today; net worth counts investments at what was put in (chosen on
              Market).
            </p>
          )}
          {unconverted.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Not in the totals (no exchange rate to {currency}):{' '}
              {unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
            </p>
          )}
        </>
      )}
      {/* also once everything is paid out or sold: what it earned stays worth seeing */}
      {loaded && <Returns />}
      {soon.length > 0 && (
        <Card
          title="Maturing soon"
          actions={
            <Link to="/investments/deposits" className="text-sm text-indigo-600 hover:underline">
              All deposits
            </Link>
          }
        >
          <ul className="space-y-2 text-sm">
            {soon.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">{d.name}</span>
                <span className="text-slate-600 tabular-nums dark:text-slate-300">
                  {formatMoney(d.maturityAmount, d.currency)}{' '}
                  {d.status === 'matured' ? 'matured' : 'on'} {dayLabel(d.maturityDate)} (
                  {whenLeft(d.daysLeft)})
                  {d.status === 'matured' && ' — mark it paid out once the money is in'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
