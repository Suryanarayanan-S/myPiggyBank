import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { api } from '../../lib/api';
import { useBucketNames } from '../../lib/buckets';
import { BUCKET_KEYS, type Family } from '../../lib/types';

export function TargetsForm({ family, onDone }: { family: Family; onDone: () => void }) {
  const names = useBucketNames();
  const queryClient = useQueryClient();
  const [t, setT] = useState(family.targets);
  const sum = t.essentials + t.fun + t.future;
  const save = useMutation({
    mutationFn: () => api.put('/family', { targets: t }),
    onSuccess: async () => {
      await Promise.all(
        ['me', 'budget'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })),
      );
      onDone();
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid grid-cols-3 gap-3">
        {BUCKET_KEYS.map((b) => (
          <Field key={b} label={`${names[b]} %`} htmlFor={`target-${b}`}>
            <Input
              id={`target-${b}`}
              type="number"
              min={0}
              max={100}
              step={1}
              value={t[b]}
              onChange={(e) => setT({ ...t, [b]: Number(e.target.value) })}
            />
          </Field>
        ))}
      </div>
      <p className={sum === 100 ? 'text-sm text-slate-500' : 'text-sm text-rose-600'}>
        Total {sum} % {sum !== 100 && '— must be 100 %'}
      </p>
      <FormError error={save.error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={sum !== 100 || save.isPending}>
          Save targets
        </Button>
      </div>
    </form>
  );
}
