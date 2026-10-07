import clsx from 'clsx';
import { Gamepad2, Sparkles } from 'lucide-react';
import { useLook } from '../lib/theme';

/** One click switches between the modern and the retro (8-bit) look. */
export function ThemeToggle({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const [look, toggle] = useLook();
  const retro = look === 'retro';
  const label = retro ? 'Switch to modern look' : 'Switch to retro look';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={retro}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
        className,
      )}
    >
      {retro ? <Sparkles size={18} aria-hidden /> : <Gamepad2 size={18} aria-hidden />}
      {!compact && (retro ? 'Modern' : 'Retro')}
    </button>
  );
}
