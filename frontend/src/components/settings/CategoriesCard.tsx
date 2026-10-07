import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { api } from '../../lib/api';
import { useCategories } from '../../lib/queries';
import { BUCKETS, type Bucket, type Category } from '../../lib/types';

type Column = { key: string; title: string; kind: 'income' | 'expense'; bucket: Bucket | null };
const COLUMNS: Column[] = [
  { key: 'income', title: 'Income', kind: 'income', bucket: null },
  { key: 'essentials', title: 'Essentials · 50%', kind: 'expense', bucket: 'essentials' },
  { key: 'fun', title: 'Fun · 30%', kind: 'expense', bucket: 'fun' },
  { key: 'future', title: 'Future You · 20%', kind: 'expense', bucket: 'future' },
];

export function CategoriesCard() {
  const categories = useCategories();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['categories'] });
  const [error, setError] = useState<unknown>(null);
  const run = (fn: () => Promise<unknown>) =>
    fn()
      .then(() => {
        setError(null);
        return refresh();
      })
      .catch(setError);

  return (
    <Card title="Categories">
      <p className="mb-4 text-sm text-slate-500">
        Every expense belongs to a bucket: Essentials, Fun or Future You (savings and investments).
      </p>
      <FormError error={error} />
      <div className="mt-2 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => (
          <CategoryColumn
            key={col.key}
            column={col}
            items={(categories.data ?? []).filter(
              (c) => c.kind === col.kind && c.bucket === col.bucket,
            )}
            run={run}
          />
        ))}
      </div>
    </Card>
  );
}

function CategoryColumn({
  column,
  items,
  run,
}: {
  column: Column;
  items: Category[];
  run: (fn: () => Promise<unknown>) => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () =>
      run(() =>
        api.post('/categories', {
          name,
          kind: column.kind,
          ...(column.bucket ? { bucket: column.bucket } : {}),
        }),
      ).then(() => setName('')),
  });

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {column.title}
      </h3>
      <ul className="space-y-1">
        {items.map((c) => (
          <li key={c.id} className="group flex items-center gap-1">
            <input
              aria-label={`Rename ${c.name}`}
              defaultValue={c.name}
              className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm hover:bg-slate-100 focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-900"
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== c.name)
                  run(() => api.put(`/categories/${c.id}`, { name: next }));
                else e.target.value = c.name;
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            {c.kind === 'expense' && (
              <span className="relative rounded p-1 text-slate-400 hover:text-slate-700 focus-within:ring-1 focus-within:ring-indigo-500 dark:hover:text-slate-200">
                <ArrowLeftRight size={14} aria-hidden />
                <select
                  aria-label={`Move ${c.name} to bucket`}
                  title="Move to another bucket"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={c.bucket ?? ''}
                  onChange={(e) =>
                    run(() => api.put(`/categories/${c.id}`, { bucket: e.target.value }))
                  }
                >
                  {Object.entries(BUCKETS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <button
              type="button"
              aria-label={`Delete ${c.name}`}
              className="rounded p-1 text-slate-400 hover:text-rose-600"
              onClick={() =>
                window.confirm(`Delete category ${c.name}?`) &&
                run(() => api.del(`/categories/${c.id}`))
              }
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Input
          aria-label={`New ${column.title} category`}
          placeholder="Add…"
          className="!py-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="secondary" className="!px-2 !py-1" aria-label="Add category">
          <Plus size={14} aria-hidden />
        </Button>
      </form>
    </div>
  );
}
