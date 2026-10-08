import clsx from 'clsx';
import { Coins } from 'lucide-react';
import { CURRENCIES } from '../lib/types';
import { useViewCurrency, type View } from '../lib/viewCurrency';

/** "Show in": every page's amounts in one chosen currency, or each page's default. */
export function CurrencySwitch({
  label = false,
  className,
}: {
  label?: boolean;
  className?: string;
}) {
  const [view, setView] = useViewCurrency();
  return (
    <label
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
        className,
      )}
      title="Show amounts in"
    >
      <Coins size={16} aria-hidden />
      {label && <span aria-hidden>Show in</span>}
      <select
        aria-label="Show amounts in"
        value={view}
        onChange={(e) => setView(e.target.value as View)}
        className="cursor-pointer bg-transparent font-medium focus:outline-none"
      >
        <option value="default">Default</option>
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}
