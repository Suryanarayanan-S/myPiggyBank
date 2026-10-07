import { PiggyBank } from 'lucide-react';

export function Brand() {
  return (
    <span className="font-pixel flex items-center gap-2 text-lg font-semibold tracking-tight">
      <PiggyBank className="text-indigo-600" size={24} aria-hidden />
      myPiggyBank
    </span>
  );
}
