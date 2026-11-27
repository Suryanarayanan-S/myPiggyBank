import clsx from 'clsx';
import { formatCompact, formatMoney } from '../../lib/money';

/** A wealth figure: compact (₹1.26 Cr) with the exact amount on hover and for screen readers. */
export function Wealth({
  cents,
  currency,
  className,
}: {
  cents: number;
  currency: string;
  className?: string;
}) {
  const full = formatMoney(cents, currency);
  return (
    <span className={clsx('tabular-nums', className)} title={full}>
      <span aria-hidden>{formatCompact(cents, currency)}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}
