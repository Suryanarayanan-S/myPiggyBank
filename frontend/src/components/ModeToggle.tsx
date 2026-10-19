import clsx from 'clsx';
import { Monitor, Moon, Sun } from 'lucide-react';
import { nextModePref, useTheme, type ModePref } from '../lib/theme';

const NAME: Record<ModePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

/** One button cycles light → dark → following the computer (works with both looks). */
export function ModeToggle({ className }: { className?: string }) {
  const { pref, chooseMode } = useTheme();
  const next = nextModePref(pref);
  const Icon = ICON[pref];
  const label = `Colour mode: ${NAME[pref]}. Switch to ${NAME[next]}`;
  return (
    <button
      type="button"
      onClick={() => chooseMode(next)}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex items-center rounded-lg px-2 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
        className,
      )}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
