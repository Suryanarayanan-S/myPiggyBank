import { useQuery } from '@tanstack/react-query';
import { Coins, PiggyBank, TrendingUp } from 'lucide-react';
import { Wealth } from '../wealth/WealthOverview';
import { Headline, IconRow, SummaryCard, Trend } from './SummaryCard';
import { api } from '../../lib/api';
import { gainClass, signed, type HoldingsResponse } from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import { dayTotal, portfolioXirr } from '../../lib/portfolio';
import { payoutTotals, rangeOf, selectPayouts, type Payout } from '../../lib/payouts';
import { localDay } from '../../lib/months';
import { maturingSoon, useDeposits, whenLeft } from '../../lib/deposits';
import { useGold } from '../../lib/gold';
import { useViewCurrency, withView } from '../../lib/viewCurrency';

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/**
 * Investments at a glance, as one card that opens them: worth today (market, deposits and gold
 * together), the latest market day's move, then the gain so far, the yearly return (XIRR) and
 * this financial year's dividends and interest in small print; deposits due soon.
 */
export function InvestmentsSummary() {
  const [view] = useViewCurrency();
  // the same request as the Investments page, so the two share it
  const q = useQuery({
    queryKey: ['holdings', view],
    queryFn: () => api.get<HoldingsResponse>(withView('/holdings', view)),
  });
  const payouts = useQuery({
    queryKey: ['holdings', 'payouts'],
    queryFn: () => api.get<Payout[]>('/holdings/payouts'),
    // only with holdings to show it for
    enabled: !!q.data && q.data.holdings.length > 0,
  });
  const deposits = useDeposits();
  const gold = useGold().data?.summary;
  const data = q.data;
  const dep = deposits.data?.summary;
  const hasMarket = !!data && data.summary.value !== 0;
  const summary = data?.summary ?? null;
  const hasDeposits = !!dep && (dep.value !== 0 || dep.unconverted.length > 0);
  // Deposits show even while the holdings load (or when they fail).
  const hasGold = !!gold && (gold.value !== 0 || gold.unconverted.length > 0);
  if (!hasMarket && !hasDeposits && !hasGold) return null;
  // a reminder a month ahead, and for matured deposits not yet marked paid out
  const soon = maturingSoon(deposits.data?.deposits ?? [], 30);
  const day = data ? dayTotal(data.holdings) : null;
  const today = localDay();
  const fy = rangeOf('fy', today);
  const received = payoutTotals(
    selectPayouts(payouts.data ?? [], {
      kind: 'all',
      from: fy.from,
      to: fy.to,
      search: '',
      sort: 'date',
      desc: true,
    }),
  ).amounts;
  // what is held, per currency (a share bought in euros stays in euros here)
  const held = new Map<string, number>();
  for (const h of data?.holdings ?? [])
    if (!h.archived && h.value) held.set(h.currency, (held.get(h.currency) ?? 0) + h.value);
  const currencies = [...held.keys()].sort((a, b) => Number(b === 'INR') - Number(a === 'INR'));
  // a holding with no price yet would count as worth nothing: no rate for its currency then
  const unpriced = new Set(
    (data?.holdings ?? [])
      .filter((h) => !h.archived && Number(h.units) > 0 && h.value === null)
      .map((h) => h.currency),
  );
  const xirrs = currencies
    .filter((c) => !unpriced.has(c))
    .map((c) => ({ currency: c, x: portfolioXirr(data!.holdings, c, today) }))
    .filter((r) => r.x !== null);
  const gainBp =
    summary && summary.invested > 0
      ? Math.round((summary.unrealised * 10_000) / summary.invested)
      : null;
  const currency = summary?.currency ?? dep?.currency ?? gold?.currency ?? 'INR';
  // the three together, in the summary currency (what has no exchange rate is named below)
  const value = (hasMarket && summary ? summary.value : 0) + (dep?.value ?? 0) + (gold?.value ?? 0);
  const unconverted = [
    ...(summary?.unconverted ?? []),
    ...(dep?.unconverted ?? []),
    ...(gold?.unconverted ?? []),
  ];
  const parts = [
    hasMarket &&
      summary && {
        key: 'market',
        label: `Market ${formatMoney(summary.value, currency)}`,
        Icon: TrendingUp,
        color: 'var(--c-cat-1)',
      },
    hasDeposits &&
      dep && {
        key: 'deposits',
        label: `Deposits ${formatMoney(dep.value, currency)}`,
        Icon: PiggyBank,
        color: 'var(--c-cat-3)',
      },
    hasGold &&
      gold && {
        key: 'gold',
        label: `Gold ${formatMoney(gold.value, currency)}`,
        Icon: Coins,
        color: 'var(--c-cat-4)',
      },
  ].filter((p) => !!p);
  const facts = [
    hasMarket && summary && (
      <span key="gain" className={gainClass(summary.unrealised)}>
        {signed(summary.unrealised, summary.currency)}
        {gainBp !== null && ` (${formatPercent(gainBp)})`} gain
      </span>
    ),
    ...xirrs.map((r) => (
      <span key={`x-${r.currency}`}>
        XIRR{' '}
        <span className={gainClass(r.x!.rate)}>
          {r.x!.rate >= 0 ? '+' : ''}
          {formatPercent(Math.round(r.x!.rate * 10_000))}
        </span>
        {xirrs.length > 1 && ` ${r.currency}`}
      </span>
    )),
    received.length > 0 && (
      <span key="div">
        {received.map((t) => formatMoney(t.amount, t.currency)).join(' + ')} dividends this FY
      </span>
    ),
    currencies.length > 1 && (
      <span key="cur">{currencies.map((c) => formatMoney(held.get(c)!, c)).join(' · ')}</span>
    ),
  ].filter(Boolean);
  return (
    <SummaryCard to="/investments" title="Investments" opens="Investments">
      <Headline>
        <Wealth cents={value} currency={currency} />
      </Headline>
      {day && summary && (
        <Trend diff={day.pnl}>
          <span className="whitespace-nowrap">
            {signed(day.pnl, summary.currency)} ({formatPercent(Math.abs(day.changeBp))})
          </span>
          <span className="text-slate-500">on {dayLabel(day.date)}</span>
        </Trend>
      )}
      {facts.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 tabular-nums dark:text-slate-400">
          {facts}
        </p>
      )}
      <IconRow parts={parts} label="Made of" />
      {unconverted.length > 0 && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Not in the total (no exchange rate):{' '}
          {unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
        </p>
      )}
      {soon.length > 0 && (
        <ul className="mt-3 space-y-0.5 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
          {soon.map((d) => (
            <li key={d.id}>
              <span className="font-medium">{d.name}</span> {d.daysLeft > 0 ? 'matures' : 'matured'}{' '}
              {whenLeft(d.daysLeft)}:{' '}
              <span className="tabular-nums">{formatMoney(d.maturityAmount, d.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </SummaryCard>
  );
}
