import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { PURITY, normaliseGrams, type GoldItem, type Purity } from '../../lib/gold';
import { formatMoney, parseMoneyInput } from '../../lib/money';
import { useMembers } from '../../lib/queries';

/** Gold counts in net worth and goals, so refresh those with it. */
export const useGoldRefresh = () => {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['gold', 'net-worth', 'goals'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    );
};

/** A piece of gold: its weight and purity (and, if known, when it was bought and for what). */
export function GoldForm({ item, onDone }: { item?: GoldItem; onDone: () => void }) {
  const refresh = useGoldRefresh();
  const members = useMembers();
  const [f, setF] = useState({
    name: item?.name ?? '',
    grams: item?.grams ?? '',
    purity: item?.purity ?? ('22k' as Purity),
    ownerMemberId: item?.ownerMemberId ?? '',
    boughtOn: item?.boughtOn ?? '',
    boughtFor:
      item?.boughtFor != null ? formatMoney(item.boughtFor, 'INR').replace(/[^\d.,]/g, '') : '',
    note: item?.note ?? '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const done = async () => {
    await refresh();
    onDone();
  };
  const save = useMutation({
    mutationFn: (body: object) =>
      item ? api.put(`/gold/${item.id}`, body) : api.post('/gold', body),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/gold/${item!.id}`),
    onSuccess: done,
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const grams = normaliseGrams(f.grams);
        const boughtFor = f.boughtFor.trim() ? parseMoneyInput(f.boughtFor) : null;
        if (grams === null) return setProblem('Enter the weight in grams, e.g. 12.5.');
        if (f.boughtFor.trim() && (boughtFor === null || boughtFor <= 0))
          return setProblem('Enter what was paid as an amount, or leave it empty.');
        setProblem(null);
        save.mutate({
          name: f.name,
          grams,
          purity: f.purity,
          ownerMemberId: f.ownerMemberId || null,
          boughtOn: f.boughtOn || null,
          boughtFor,
          note: f.note || null,
        });
      }}
    >
      <Field label="Name" htmlFor="g-name">
        <Input
          id="g-name"
          required
          maxLength={60}
          placeholder="Wedding necklace"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Weight (grams)" htmlFor="g-grams">
          <Input
            id="g-grams"
            required
            inputMode="decimal"
            placeholder="12.5"
            value={f.grams}
            onChange={(e) => setF({ ...f, grams: e.target.value })}
          />
        </Field>
        <Field label="Purity" htmlFor="g-purity">
          <Select
            id="g-purity"
            value={f.purity}
            onChange={(e) => setF({ ...f, purity: e.target.value as Purity })}
          >
            {Object.entries(PURITY).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bought on (optional)" htmlFor="g-bought-on">
          <Input
            id="g-bought-on"
            type="date"
            value={f.boughtOn}
            onChange={(e) => setF({ ...f, boughtOn: e.target.value })}
          />
        </Field>
        <Field label="Paid, ₹ (optional)" htmlFor="g-bought-for">
          <Input
            id="g-bought-for"
            inputMode="decimal"
            placeholder="45,000"
            value={f.boughtFor}
            onChange={(e) => setF({ ...f, boughtFor: e.target.value })}
          />
        </Field>
        <Field label="Belongs to" htmlFor="g-owner">
          <Select
            id="g-owner"
            value={f.ownerMemberId}
            onChange={(e) => setF({ ...f, ownerMemberId: e.target.value })}
          >
            <option value="">Shared</option>
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Note (optional)" htmlFor="g-note">
        <Input
          id="g-note"
          maxLength={500}
          value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })}
        />
      </Field>
      {problem && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {problem}
        </p>
      )}
      <FormError error={save.error ?? remove.error} />
      <div className="flex justify-between gap-2">
        {item ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => window.confirm(`Delete “${item.name}”?`) && remove.mutate()}
          >
            <Trash2 size={16} aria-hidden /> Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
