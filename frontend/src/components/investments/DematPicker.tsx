import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { firstDematTakes } from '../../lib/demat';
import type { HoldingsResponse } from '../../lib/investments';
import { useAccounts, useMembers } from '../../lib/queries';
import type { Account } from '../../lib/types';
import { useViewCurrency, withView } from '../../lib/viewCurrency';

/** How many of the person's holdings a new demat of theirs would take (their first demat). */
export function useFirstDematTakes(ownerMemberId: string | null) {
  const accounts = useAccounts();
  const [view] = useViewCurrency();
  const holdings = useQuery({
    queryKey: ['holdings', view],
    queryFn: () => api.get<HoldingsResponse>(withView('/holdings', view)),
  });
  return firstDematTakes(holdings.data?.holdings ?? [], accounts.data ?? [], ownerMemberId);
}

/** The note under a new demat's owner: what it will take. */
export function TakesNote({ count, owner }: { count: number; owner: string | null }) {
  if (count === 0) return null;
  const what = count === 1 ? 'holding' : `${count} holdings`;
  return (
    <p className="text-xs text-slate-500">
      {owner ? `${owner}’s ${what}` : `The ${what} shared by the family`} not in a demat account
      will be moved into it.
    </p>
  );
}

/** Where an import goes: a demat account (whose owner it is), or a person without one. */
export type Demat = { accountId: string | null; ownerMemberId: string | null };

/** Demat accounts: open accounts of the type Investment. */
export function useDemats() {
  return useDematsLoaded()[0];
}
function useDematsLoaded() {
  const accounts = useAccounts();
  const list = (accounts.data ?? []).filter((a) => a.type === 'investment' && !a.archived);
  return [list, !!accounts.data] as const;
}

/** A new demat account in rupees: a name (broker and client ID) and whose it is. */
export function NewDematForm({
  onCreated,
  onCancel,
}: {
  onCreated: (a: Account) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const members = useMembers();
  const [name, setName] = useState('');
  // the logged-in person until another is chosen
  const [owner, setOwner] = useState<string | undefined>(undefined);
  const ownerId = owner ?? members.data?.find((m) => m.isUser)?.id ?? '';
  const takes = useFirstDematTakes(ownerId || null);
  const ownerName = members.data?.find((m) => m.id === ownerId)?.name ?? null;
  const create = useMutation({
    mutationFn: () =>
      api.post<Account>('/accounts', {
        name,
        type: 'investment',
        currency: 'INR',
        ownerMemberId: ownerId || null,
      }),
    onSuccess: async (a) => {
      // a first demat takes the person's holdings
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      await queryClient.invalidateQueries({ queryKey: ['holdings'] });
      onCreated(a);
    },
  });
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Demat name" htmlFor="demat-name" hint="Broker and client ID">
          <Input
            id="demat-name"
            maxLength={60}
            placeholder="Zerodha · XHY083"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Belongs to" htmlFor="demat-owner">
          <Select id="demat-owner" value={ownerId} onChange={(e) => setOwner(e.target.value)}>
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value="">Shared</option>
          </Select>
        </Field>
      </div>
      <TakesNote count={takes} owner={ownerName} />
      <FormError error={create.error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() => create.mutate()}
          disabled={!name.trim() || !members.data || create.isPending}
        >
          Add demat account
        </Button>
      </div>
    </div>
  );
}

const valueOf = (d: Demat) => (d.accountId ? `a:${d.accountId}` : `m:${d.ownerMemberId ?? ''}`);

/**
 * "Which demat is this?" for an import: the demat accounts, each person without one, or a new
 * demat account made on the spot. Until one is chosen: the logged-in person's first demat, else
 * the person.
 */
export function useDematChoice() {
  const members = useMembers();
  const [demats, loaded] = useDematsLoaded();
  const [chosen, setChosen] = useState<Demat | undefined>(undefined);
  const me = members.data?.find((m) => m.isUser)?.id ?? null;
  const mine = demats.find((a) => a.ownerMemberId === me);
  const value: Demat = chosen ?? { accountId: mine?.id ?? null, ownerMemberId: me };
  // a file read before the demats are known would be previewed for the wrong one
  return [value, setChosen, !!members.data && loaded] as const;
}

export function DematPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Demat;
  onChange: (d: Demat) => void;
}) {
  const members = useMembers();
  const demats = useDemats();
  const [adding, setAdding] = useState(false);
  const name = (owner: string | null) =>
    owner ? (members.data?.find((m) => m.id === owner)?.name ?? '—') : 'Shared';
  return (
    <div className="space-y-3 sm:col-span-2">
      <Field
        label="Which demat is this?"
        htmlFor={id}
        hint="Each person’s holdings go into their own demat account."
      >
        <Select
          id={id}
          value={adding ? 'new' : valueOf(value)}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'new') return setAdding(true);
            setAdding(false);
            const a = demats.find((d) => `a:${d.id}` === v);
            onChange(
              a
                ? { accountId: a.id, ownerMemberId: a.ownerMemberId }
                : { accountId: null, ownerMemberId: v.slice(2) || null },
            );
          }}
        >
          {demats.length > 0 && (
            <optgroup label="Demat accounts">
              {demats.map((a) => (
                <option key={a.id} value={`a:${a.id}`}>
                  {a.name} — {name(a.ownerMemberId)}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="No demat account">
            {members.data?.map((m) => (
              <option key={m.id} value={`m:${m.id}`}>
                {m.name}
              </option>
            ))}
            <option value="m:">Shared</option>
          </optgroup>
          <option value="new">New demat account…</option>
        </Select>
      </Field>
      {adding && (
        <NewDematForm
          onCancel={() => setAdding(false)}
          onCreated={(a) => {
            setAdding(false);
            onChange({ accountId: a.id, ownerMemberId: a.ownerMemberId });
          }}
        />
      )}
    </div>
  );
}
