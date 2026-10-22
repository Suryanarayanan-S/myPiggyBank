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
import { useAccounts, useCategories, useMembers } from '../../lib/queries';
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

/**
 * A fixed deposit (amount, rate, dates) or a recurring one (monthly instalment for some months,
 * optionally booked from its account each month). The money comes from, and returns to, an
 * account.
 */
export function DepositForm({
  deposit,
  kind: newKind = 'fd',
  defaultCurrency,
  onDone,
}: {
  deposit?: Deposit;
  /** for a new deposit */
  kind?: Deposit['kind'];
  defaultCurrency: string;
  onDone: () => void;
}) {
  const kind = deposit?.kind ?? newKind;
  const rd = kind === 'rd';
  const categories = useCategories();
  const refresh = useDepositRefresh();
  const members = useMembers();
  const accounts = useAccounts();
  const today = localDay();
  const [f, setF] = useState({
    name: deposit?.name ?? '',
    accountId: deposit?.accountId ?? '',
    currency: deposit?.currency ?? defaultCurrency,
    ownerMemberId: deposit?.ownerMemberId ?? '',
    // a recurring deposit's amount is its monthly instalment
    principal: deposit
      ? formatMoney(rd ? deposit.instalment! : deposit.principal, deposit.currency).replace(
          /[^\d.,]/g,
          '',
        )
      : '',
    months: String(deposit?.months ?? 12),
    // booking is opted into, never assumed
    book: deposit ? deposit.book !== null : false,
    categoryId: deposit?.book?.categoryId ?? '',
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
        const months = Number(f.months);
        if (principal === null || principal <= 0)
          return setProblem(rd ? 'Enter the monthly instalment.' : 'Enter the amount deposited.');
        if (rateBp === null) return setProblem('Enter the yearly rate in %, e.g. 7.25.');
        if (rd && !(Number.isInteger(months) && months >= 1 && months <= 120))
          return setProblem('Enter for how many months, from 1 to 120.');
        const book = rd && f.book && f.accountId;
        setProblem(null);
        save.mutate({
          ...(!deposit && { kind }),
          ...(rd
            ? { months, book: book ? { categoryId: f.categoryId || null } : null }
            : { maturityDate: f.maturityDate, interest: f.interest }),
          name: f.name,
          currency: f.currency,
          accountId: f.accountId || null,
          ownerMemberId: f.ownerMemberId || null,
          principal,
          rateBp,
          startDate: f.startDate,
          compounding: f.compounding,
          note: f.note || null,
        });
      }}
    >
      <Field label="Name" htmlFor="d-name">
        <Input
          id="d-name"
          required
          maxLength={60}
          placeholder={rd ? 'Post office RD' : 'HDFC FD 2026'}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <Field
        label="Bank account (optional)"
        htmlFor="d-account"
        hint={
          rd
            ? 'Where the instalments come from and the money is paid back to.'
            : 'Where the money came from and is paid back to.'
        }
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
      {rd && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!f.accountId}
              checked={f.book && !!f.accountId}
              onChange={(e) => setF({ ...f, book: e.target.checked })}
            />
            Book the instalment from this account each month
          </label>
          {f.book && f.accountId && (
            <Field label="Category of the instalment" htmlFor="d-category">
              <Select
                id="d-category"
                value={f.categoryId}
                onChange={(e) => setF({ ...f, categoryId: e.target.value })}
              >
                <option value="">—</option>
                {categories.data
                  ?.filter((c) => c.kind === 'expense')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={rd ? 'Monthly instalment' : 'Amount deposited'} htmlFor="d-principal">
          <Input
            id="d-principal"
            required
            inputMode="decimal"
            placeholder={rd ? '5,000' : '1,00,000'}
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
        <Field label={rd ? 'First instalment' : 'Start date'} htmlFor="d-start">
          <Input
            id="d-start"
            type="date"
            required
            value={f.startDate}
            onChange={(e) => setF({ ...f, startDate: e.target.value })}
          />
        </Field>
        {rd ? (
          <Field label="Months" htmlFor="d-months" hint="It matures a month after the last.">
            <Input
              id="d-months"
              required
              type="number"
              min={1}
              max={120}
              value={f.months}
              onChange={(e) => setF({ ...f, months: e.target.value })}
            />
          </Field>
        ) : (
          <>
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
          </>
        )}
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
