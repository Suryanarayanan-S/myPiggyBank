import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { COMPOUNDING, parseRatePercent, type Compounding, type Deposit } from '../../lib/deposits';
import { formatMoney, parseMoneyInput } from '../../lib/money';
import { localDay } from '../../lib/months';
import { useAccounts, useMembers } from '../../lib/queries';
import { CURRENCIES } from '../../lib/types';

/** Deposits count in net worth (and show on their account), so refresh those with them. */
export const useDepositRefresh = () => {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['deposits', 'net-worth', 'goals'].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      ),
    );
};

const addYear = (day: string) => `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;

/** A fixed deposit: amount, rate and dates; the money comes from (and returns to) an account. */
export function DepositForm({
  deposit,
  defaultCurrency,
  onDone,
}: {
  deposit?: Deposit;
  defaultCurrency: string;
  onDone: () => void;
}) {
  const refresh = useDepositRefresh();
  const members = useMembers();
  const accounts = useAccounts();
  const today = localDay();
  const [f, setF] = useState({
    name: deposit?.name ?? '',
    accountId: deposit?.accountId ?? '',
    currency: deposit?.currency ?? defaultCurrency,
    ownerMemberId: deposit?.ownerMemberId ?? '',
    principal: deposit
      ? formatMoney(deposit.principal, deposit.currency).replace(/[^\d.,]/g, '')
      : '',
    rate: deposit ? String(deposit.rateBp / 100) : '',
    startDate: deposit?.startDate ?? today,
    maturityDate: deposit?.maturityDate ?? addYear(today),
    compounding: deposit?.compounding ?? ('quarterly' as Compounding),
    interest: deposit?.interest ?? ('reinvest' as Deposit['interest']),
    note: deposit?.note ?? '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const done = async () => {
    await refresh();
    onDone();
  };
  const save = useMutation({
    mutationFn: (body: object) =>
      deposit ? api.put(`/deposits/${deposit.id}`, body) : api.post('/deposits', body),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/deposits/${deposit!.id}`),
    onSuccess: done,
  });
  const open = accounts.data?.filter((a) => !a.archived || a.id === f.accountId) ?? [];

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const principal = parseMoneyInput(f.principal);
        const rateBp = parseRatePercent(f.rate);
        if (principal === null || principal <= 0) return setProblem('Enter the amount deposited.');
        if (rateBp === null) return setProblem('Enter the yearly rate in %, e.g. 7.25.');
        setProblem(null);
        save.mutate({
          name: f.name,
          currency: f.currency,
          accountId: f.accountId || null,
          ownerMemberId: f.ownerMemberId || null,
          principal,
          rateBp,
          startDate: f.startDate,
          maturityDate: f.maturityDate,
          compounding: f.compounding,
          interest: f.interest,
          note: f.note || null,
        });
      }}
    >
      <Field label="Name" htmlFor="d-name">
        <Input
          id="d-name"
          required
          maxLength={60}
          placeholder="HDFC FD 2026"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <Field
        label="Bank account (optional)"
        htmlFor="d-account"
        hint="Where the money came from and is paid back to."
      >
        <Select
          id="d-account"
          value={f.accountId}
          onChange={(e) => {
            const a = open.find((x) => x.id === e.target.value);
            // the deposit is in the account's currency
            setF({ ...f, accountId: e.target.value, currency: a?.currency ?? f.currency });
          }}
        >
          <option value="">—</option>
          {open.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount deposited" htmlFor="d-principal">
          <Input
            id="d-principal"
            required
            inputMode="decimal"
            placeholder="1,00,000"
            value={f.principal}
            onChange={(e) => setF({ ...f, principal: e.target.value })}
          />
        </Field>
        <Field
          label="Currency"
          htmlFor="d-currency"
          hint={f.accountId ? 'The account’s currency.' : undefined}
        >
          <Select
            id="d-currency"
            disabled={!!f.accountId}
            value={f.currency}
            onChange={(e) => setF({ ...f, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Yearly rate (%)" htmlFor="d-rate">
          <Input
            id="d-rate"
            required
            inputMode="decimal"
            placeholder="7.25"
            value={f.rate}
            onChange={(e) => setF({ ...f, rate: e.target.value })}
          />
        </Field>
        <Field label="Compounded" htmlFor="d-compounding">
          <Select
            id="d-compounding"
            value={f.compounding}
            onChange={(e) => setF({ ...f, compounding: e.target.value as Compounding })}
          >
            {Object.entries(COMPOUNDING).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start date" htmlFor="d-start">
          <Input
            id="d-start"
            type="date"
            required
            value={f.startDate}
            onChange={(e) => setF({ ...f, startDate: e.target.value })}
          />
        </Field>
        <Field label="Maturity date" htmlFor="d-maturity">
          <Input
            id="d-maturity"
            type="date"
            required
            value={f.maturityDate}
            onChange={(e) => setF({ ...f, maturityDate: e.target.value })}
          />
        </Field>
        <Field label="Interest" htmlFor="d-interest">
          <Select
            id="d-interest"
            value={f.interest}
            onChange={(e) => setF({ ...f, interest: e.target.value as Deposit['interest'] })}
          >
            <option value="reinvest">Added, paid at maturity</option>
            <option value="payout">Paid out each period</option>
          </Select>
        </Field>
        <Field label="Belongs to" htmlFor="d-owner">
          <Select
            id="d-owner"
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
      <Field label="Note (optional)" htmlFor="d-note">
        <Input
          id="d-note"
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
        {deposit ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => window.confirm(`Delete “${deposit.name}”?`) && remove.mutate()}
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
