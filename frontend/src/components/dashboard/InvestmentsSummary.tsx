import { useQuery } from '@tanstack/react-query';
import { Coins, PiggyBank, TrendingUp } from 'lucide-react';
import { Wealth } from '../wealth/WealthOverview';
import { Headline, IconRow, SummaryCard, Trend } from './SummaryCard';
import { Sparkline } from './Sparkline';
import { api } from '../../lib/api';
import type { HoldingsResponse } from '../../lib/investments';
import { formatCompact, formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import { dayTotal } from '../../lib/portfolio';
import { useDeposits } from '../../lib/deposits';
import { useGold } from '../../lib/gold';
import { useViewCurrency, withView } from '../../lib/viewCurrency';

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

type History = { currency: string; points: { date: string; value: number }[] };

/**
 * Investments at a glance, as one card that opens them: worth today (market, deposits and gold
 * together, rounded), the latest market day's move, what it is made of, and its value over the
 * last year. The gain, XIRR and dividends are a click away.
 */
export function InvestmentsSummary() {
  const [view] = useViewCurrency();
  // the same request as the Investments page, so the two share it
  const q = useQuery({
    queryKey: ['holdings', view],
    queryFn: () => api.get<HoldingsResponse>(withView('/holdings', view)),
  });
  const history = useQuery({
    queryKey: ['investment-history', view],
    queryFn: () => api.get<History>(withView('/investments/history', view)),
  });
  const deposits = useDeposits();
  const gold = useGold().data?.summary;
  const data = q.data;
  const dep = deposits.data?.summary;
  const summary = data?.summary ?? null;
  const hasMarket = !!summary && summary.value !== 0;
  const hasDeposits = !!dep && (dep.value !== 0 || dep.unconverted.length > 0);
  // Deposits show even while the holdings load (or when they fail).
  const hasGold = !!gold && (gold.value !== 0 || gold.unconverted.length > 0);
  if (!hasMarket && !hasDeposits && !hasGold) return null;
  const day = data ? dayTotal(data.holdings) : null;
  const currency = summary?.currency ?? dep?.currency ?? gold?.currency ?? 'INR';
  // the three together, in the summary currency (what has no exchange rate is named below)
  const value = (hasMarket ? summary.value : 0) + (dep?.value ?? 0) + (gold?.value ?? 0);
  const unconverted = [
    ...(summary?.unconverted ?? []),
    ...(dep?.unconverted ?? []),
    ...(gold?.unconverted ?? []),
  ];
  const parts = [
    hasMarket && {
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
  const points = history.data?.currency === currency ? history.data.points : [];
  return (
    <SummaryCard
      to="/investments"
      title="Investments"
      opens="Investments"
      chart={<Sparkline values={points.map((p) => p.value)} />}
    >
      <Headline>
        <Wealth cents={value} currency={currency} />
      </Headline>
      {day && summary && (
        <Trend diff={day.pnl}>
          <span className="whitespace-nowrap">
            {day.pnl > 0 ? '+' : day.pnl < 0 ? '−' : ''}
            {Math.abs(day.pnl) < 10_000
              ? formatMoney(Math.abs(day.pnl), summary.currency)
              : formatCompact(Math.abs(day.pnl), summary.currency)}{' '}
            ({formatPercent(Math.abs(day.changeBp))})
          </span>
          <span className="text-slate-500">on {dayLabel(day.date)}</span>
        </Trend>
      )}
      <IconRow parts={parts} label="Made of" />
      {unconverted.length > 0 && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Not in the total (no exchange rate):{' '}
          {unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
        </p>
      )}
    </SummaryCard>
  );
}
