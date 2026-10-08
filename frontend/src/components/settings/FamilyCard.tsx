import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { CURRENCIES, type Family } from '../../lib/types';

export function FamilyCard({ family, email }: { family: Family; email: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: family.name,
    spendingCurrency: family.spendingCurrency,
    wealthCurrency: family.wealthCurrency,
  });
  const save = useMutation({
    mutationFn: () => api.put('/family', form),
    // Currencies change every converted figure, so refresh everything.
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const dirty =
    form.name !== family.name ||
    form.spendingCurrency !== family.spendingCurrency ||
    form.wealthCurrency !== family.wealthCurrency;

  return (
    <Card title="Family">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Family name" htmlFor="fam-name">
          <Input
            id="fam-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monthly spending in" htmlFor="fam-spend">
            <Select
              id="fam-spend"
              value={form.spendingCurrency}
              onChange={(e) => setForm({ ...form, spendingCurrency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Family wealth in" htmlFor="fam-wealth">
            <Select
              id="fam-wealth"
              value={form.wealthCurrency}
              onChange={(e) => setForm({ ...form, wealthCurrency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-slate-500">Logged in as {email}</p>
        <FormError error={save.error} />
        <div className="flex justify-end">
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isSuccess && !dirty ? 'Saved' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
