import clsx from 'clsx';
import { formatMoney } from '../../lib/money';

/** Money with meaningful colour: positive green, negative rose, zero/neutral slate. */
export function Amount({
  cents,
  currency,
  signed = false,
  className,
}: {
  cents: number;
  currency: string;
  signed?: boolean;
  className?: string;
}) {
  const text = formatMoney(cents, currency);
  return (
    <span
      className={clsx(
        'tabular-nums',
        signed && cents > 0 && 'text-emerald-600 dark:text-emerald-400',
        signed && cents < 0 && 'text-rose-600 dark:text-rose-400',
        className,
      )}
    >
      {signed && cents > 0 ? `+${text}` : text}
    </span>
  );
}
