import clsx from 'clsx';

const SIGN: Record<string, string> = { INR: '₹ Indian', EUR: '€ Euro' };

/** Which holdings a comparison card compares, when they are in more than one currency. */
export function CurrencySwitch({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Holdings to compare"
      className="mb-3 inline-flex rounded-lg border border-slate-200 p-0.5 text-sm dark:border-slate-700"
    >
      {options.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={clsx(
            'rounded-md px-3 py-1',
            value === c
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
          )}
        >
          {SIGN[c] ?? c} holdings
        </button>
      ))}
    </div>
  );
}
