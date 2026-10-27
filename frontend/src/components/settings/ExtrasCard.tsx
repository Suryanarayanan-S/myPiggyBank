import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '../ui/Card';
import { FormError } from '../ui/Field';
import { Switch } from '../ui/Switch';
import { api } from '../../lib/api';
import type { Family } from '../../lib/types';

const EXTRAS: { key: keyof Family['extras']; label: string; hint: string }[] = [
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
              <Switch
                on={on}
                labelId={`extra-${x.key}`}
                hintId={`extra-${x.key}-hint`}
                disabled={save.isPending}
                onChange={(next) => save.mutate({ [x.key]: next })}
              />
            </li>
          );
        })}
      </ul>
      <FormError error={save.error} />
    </Card>
  );
}
