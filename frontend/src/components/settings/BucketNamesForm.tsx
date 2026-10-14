import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { api } from '../../lib/api';
import { BUCKET_KEYS, type Family } from '../../lib/types';

const LABEL = { essentials: 'Needs bucket', fun: 'Wants bucket', future: 'Saving bucket' };

/** What the family calls its three buckets (shown on every page). */
export function BucketNamesForm({ family }: { family: Family }) {
  const queryClient = useQueryClient();
  const [names, setNames] = useState(family.bucketNames);
  const save = useMutation({
    mutationFn: () => api.put<Family>('/family', { bucketNames: names }),
    onSuccess: (saved) => {
      // Show what was stored (names are trimmed), so the form is no longer "changed".
      setNames(saved.bucketNames);
      // Bucket names are labels on every page: refresh all.
      return queryClient.invalidateQueries();
    },
  });
  const dirty = BUCKET_KEYS.some((b) => names[b] !== family.bucketNames[b]);

  return (
    <form
      className="mb-5 space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What you call your buckets</legend>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          {BUCKET_KEYS.map((b) => (
            <Field key={b} label={LABEL[b]} htmlFor={`bucket-${b}`}>
              <Input
                id={`bucket-${b}`}
                required
                maxLength={30}
                value={names[b]}
                onChange={(e) => setNames({ ...names, [b]: e.target.value })}
              />
            </Field>
          ))}
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isSuccess && !dirty ? 'Saved' : 'Save'}
          </Button>
        </div>
      </fieldset>
      <FormError error={save.error} />
    </form>
  );
}
