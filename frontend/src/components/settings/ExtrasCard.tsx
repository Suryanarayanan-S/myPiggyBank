import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '../ui/Card';
import { FormError } from '../ui/Field';
import { api } from '../../lib/api';
import type { Family } from '../../lib/types';

const EXTRAS: { key: keyof Family['extras']; label: string; hint: string }[] = [
  {
    key: 'moneyStory',
    label: 'Money story on the dashboard',
    hint: 'A playful recap of the latest month, compared with the months before.',
  },
  {
    key: 'quickEntrySuggestions',
    label: 'Suggestions in Quick entry',
    hint: 'Fill empty boxes from last month or your usual amounts, then check and save.',
  },
];

export function ExtrasCard({ family }: { family: Family }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (extras: Partial<Family['extras']>) => api.put('/family', { extras }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  });
  return (
    <Card title="Extras">
      <ul className="space-y-4">
        {EXTRAS.map((x) => {
          const on = family.extras[x.key];
          return (
            <li key={x.key} className="flex items-start justify-between gap-4">
              <div>
                <p id={`extra-${x.key}`} className="text-sm font-medium">
                  {x.label}
                </p>
                <p id={`extra-${x.key}-hint`} className="text-xs text-slate-500">
                  {x.hint}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-labelledby={`extra-${x.key}`}
                aria-describedby={`extra-${x.key}-hint`}
                disabled={save.isPending}
                onClick={() => save.mutate({ [x.key]: !on })}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none ${
                  on ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    on ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
      <FormError error={save.error} />
    </Card>
  );
}
