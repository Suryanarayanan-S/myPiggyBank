import { useQuery } from '@tanstack/react-query';
import { Wealth } from '../wealth/WealthOverview';
import { Headline, SummaryCard } from './SummaryCard';
import { Sparkline } from './Sparkline';
import { api } from '../../lib/api';
import type { HoldingsResponse } from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import { useDeposits } from '../../lib/deposits';
import { useInvestmentHistory } from '../../lib/history';
import { useGold } from '../../lib/gold';
import { useViewCurrency, withView } from '../../lib/viewCurrency';

/**
 * Investments at a glance, as one card that opens them: worth today (market, deposits and gold
 * together, rounded) and its value over the last year. The day's move, the gain, XIRR and
 * dividends are a click away.
 */
export function InvestmentsSummary() {
  const [view] = useViewCurrency();
  // the same request as the Investments page, so the two share it
  const q = useQuery({
    queryKey: ['holdings', view],
    queryFn: () => api.get<HoldingsResponse>(withView('/holdings', view)),
  });
  // the year, like the other cards (the Investments page has the other ranges)
  const history = useInvestmentHistory('1y');
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
  const currency = summary?.currency ?? dep?.currency ?? gold?.currency ?? 'INR';
  // the three together, in the summary currency (what has no exchange rate is named below)
  const value = (hasMarket ? summary.value : 0) + (dep?.value ?? 0) + (gold?.value ?? 0);
  const unconverted = [
    ...(summary?.unconverted ?? []),
    ...(dep?.unconverted ?? []),
    ...(gold?.unconverted ?? []),
  ];
  const line = history.data?.currency === currency ? history.data.total : [];
  return (
    <SummaryCard
      to="/investments"
      title="Investments"
      opens="Investments"
      className="flex flex-col"
      chartBelow
      chart={<Sparkline values={line} height={56} />}
    >
      <Headline>
        <Wealth cents={value} currency={currency} />
      </Headline>
      {unconverted.length > 0 && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Not in the total (no exchange rate):{' '}
          {unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
        </p>
      )}
    </SummaryCard>
  );
}
