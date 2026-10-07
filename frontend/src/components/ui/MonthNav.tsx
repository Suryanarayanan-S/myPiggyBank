import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { monthTitle, shiftMonth } from '../../lib/months';

export function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft size={18} aria-hidden />
      </Button>
      <h1 className="min-w-44 text-center text-2xl font-semibold tracking-tight">
        {monthTitle(month)}
      </h1>
      <Button
        variant="ghost"
        aria-label="Next month"
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight size={18} aria-hidden />
      </Button>
    </div>
  );
}
