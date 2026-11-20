import { PiggyBank } from 'lucide-react';

/** The logo and name; `compact` (phone header): the logo alone, the name for screen readers. */
export function Brand({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
      <PiggyBank className="shrink-0 text-indigo-600" size={24} aria-hidden />
      <span className={compact ? 'sr-only' : undefined}>myPiggyBank</span>
    </span>
  );
}
