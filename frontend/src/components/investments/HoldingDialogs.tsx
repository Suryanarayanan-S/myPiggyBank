import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import {
  HOLDING_KINDS,
  formatUnits,
  normaliseDecimal,
  type Holding,
  type HoldingKind,
} from '../../lib/investments';
import { formatMoney, parseMoneyInput } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import { localDay } from '../../lib/months';
import { useAccounts, useMembers } from '../../lib/queries';
import { CURRENCIES } from '../../lib/types';

/** Holdings change net worth and goals too, so refresh those with them. */
const useRefresh = () => {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['holdings', 'net-worth', 'goals'].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      ),
    );
};

export function HoldingForm({
  holding,
  defaultCurrency,
  onDone,
}: {
  holding?: Holding;
  defaultCurrency: string;
  onDone: () => void;
}) {
  const refresh = useRefresh();
  const members = useMembers();
  const accounts = useAccounts();
  const [f, setF] = useState({
    name: holding?.name ?? '',
    kind: holding?.kind ?? ('etf' as HoldingKind),
    symbol: holding?.symbol ?? '',
    currency: holding?.currency ?? defaultCurrency,
    ownerMemberId: holding?.ownerMemberId ?? '',
    accountId: holding?.accountId ?? '',
    note: holding?.note ?? '',
    archived: holding?.archived ?? false,
  });
  const done = async () => {
    await refresh();
    onDone();
  };
  const save = useMutation({
    mutationFn: (body: object) =>
      holding ? api.put(`/holdings/${holding.id}`, body) : api.post('/holdings', body),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/holdings/${holding!.id}`),
    onSuccess: done,
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          ...f,
          symbol: f.symbol || null,
          ownerMemberId: f.ownerMemberId || null,
          accountId: f.accountId || null,
          note: f.note || null,
        });
      }}
    >
      <Field label="Name" htmlFor="h-name">
        <Input
          id="h-name"
          required
          maxLength={60}
          placeholder="MSCI World ETF"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind" htmlFor="h-kind">
          <Select
            id="h-kind"
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value as HoldingKind })}
          >
            {Object.entries(HOLDING_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ticker or ISIN (optional)" htmlFor="h-symbol">
          <Input
            id="h-symbol"
            maxLength={20}
            value={f.symbol}
            onChange={(e) => setF({ ...f, symbol: e.target.value })}
          />
        </Field>
        <Field label="Currency" htmlFor="h-currency">
          <Select
            id="h-currency"
            disabled={!!holding?.trades.length}
            value={f.currency}
            onChange={(e) => setF({ ...f, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Belongs to" htmlFor="h-owner">
          <Select
            id="h-owner"
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
      <Field label="Depot (optional)" htmlFor="h-account" hint="The account it is held in.">
        <Select
          id="h-account"
          value={f.accountId}
          onChange={(e) => setF({ ...f, accountId: e.target.value })}
        >
          <option value="">—</option>
          {accounts.data
            ?.filter((a) => !a.archived || a.id === f.accountId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Note (optional)" htmlFor="h-note">
        <Input
          id="h-note"
          maxLength={500}
          value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })}
        />
      </Field>
      {holding && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.archived}
            onChange={(e) => setF({ ...f, archived: e.target.checked })}
          />
          Archived (sold off; kept for its history, not counted)
        </label>
      )}
      <FormError error={save.error ?? remove.error} />
      <div className="flex justify-between gap-2">
        {holding ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              window.confirm(`Delete “${holding.name}” with all its trades and prices?`) &&
              remove.mutate()
            }
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

const TYPE_LABEL = { buy: 'Buy', sell: 'Sell', dividend: 'Dividend' } as const;

/** Trades and prices of one holding. */
export function HoldingActivity({ holding, onDone }: { holding: Holding; onDone: () => void }) {
  const refresh = useRefresh();
  const money = (c: number) => formatMoney(c, holding.currency);
  const [t, setT] = useState({
    date: localDay(),
    type: 'buy' as 'buy' | 'sell' | 'dividend',
    units: '',
    amount: '',
    fees: '',
  });
  const [p, setP] = useState({ date: localDay(), price: '' });
  const [err, setErr] = useState<string | null>(null);
  const [priceErr, setPriceErr] = useState<string | null>(null);
  const addTrade = useMutation({
    mutationFn: (body: object) => api.post(`/holdings/${holding.id}/trades`, body),
    onSuccess: async () => {
      setT({ ...t, units: '', amount: '', fees: '' });
      await refresh();
    },
  });
  const delTrade = useMutation({
    mutationFn: (id: string) => api.del(`/holdings/${holding.id}/trades/${id}`),
    onSuccess: refresh,
  });
  const addPrice = useMutation({
    mutationFn: (body: object) => api.post(`/holdings/${holding.id}/prices`, body),
    onSuccess: async () => {
      setP({ ...p, price: '' });
      await refresh();
    },
  });
  const delPrice = useMutation({
    mutationFn: (id: string) => api.del(`/holdings/${holding.id}/prices/${id}`),
    onSuccess: refresh,
  });
  const units = normaliseDecimal(t.units);
  const amount = parseMoneyInput(t.amount);
  const fees = t.fees.trim() ? parseMoneyInput(t.fees) : 0;
  const price = normaliseDecimal(p.price);

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4 dark:bg-slate-800/60">
        <div>
          <dt className="text-xs text-slate-500">Value</dt>
          <dd className="font-medium tabular-nums">
            {holding.value === null ? '—' : money(holding.value)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Gain / loss now</dt>
          <dd className="tabular-nums">
            {holding.unrealised === null ? '—' : money(holding.unrealised)}
            {holding.returnBp !== null && ` · ${formatPercent(holding.returnBp)}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">From sales</dt>
          <dd className="tabular-nums">
            {money(holding.realised)}
            {holding.realisedBp !== null && ` · ${formatPercent(holding.realisedBp)}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Dividends</dt>
          <dd className="tabular-nums">{money(holding.dividends)}</dd>
        </div>
      </dl>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Add a trade</h3>
        <form
          className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (t.type !== 'dividend' && !units)
              return setErr('Enter the number of units, e.g. 12,5');
            if (!amount || amount <= 0) return setErr('Enter the total amount');
            if (fees === null || fees < 0) return setErr('Fees must be 0 or more');
            setErr(null);
            addTrade.mutate({
              date: t.date,
              type: t.type,
              ...(t.type !== 'dividend' && { units }),
              amount,
              ...(t.type !== 'dividend' && { fees }),
            });
          }}
        >
          <Field label="Date" htmlFor="t-date">
            <Input
              id="t-date"
              type="date"
              required
              value={t.date}
              onChange={(e) => setT({ ...t, date: e.target.value })}
            />
          </Field>
          <Field label="Type" htmlFor="t-type">
            <Select
              id="t-type"
              value={t.type}
              onChange={(e) => setT({ ...t, type: e.target.value as typeof t.type })}
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
              <option value="dividend">Dividend</option>
            </Select>
          </Field>
          {t.type !== 'dividend' && (
            <Field label="Units" htmlFor="t-units">
              <Input
                id="t-units"
                inputMode="decimal"
                placeholder="12,5"
                value={t.units}
                onChange={(e) => setT({ ...t, units: e.target.value })}
              />
            </Field>
          )}
          <Field
            label={t.type === 'buy' ? 'Total paid' : 'Total received'}
            htmlFor="t-amount"
            hint={amount ? money(amount) : undefined}
          >
            <Input
              id="t-amount"
              inputMode="decimal"
              value={t.amount}
              onChange={(e) => setT({ ...t, amount: e.target.value })}
            />
          </Field>
          {t.type !== 'dividend' && (
            <Field label="Fees" htmlFor="t-fees">
              <Input
                id="t-fees"
                inputMode="decimal"
                placeholder="0"
                value={t.fees}
                onChange={(e) => setT({ ...t, fees: e.target.value })}
              />
            </Field>
          )}
          <Button type="submit" disabled={addTrade.isPending}>
            Add trade
          </Button>
        </form>
        {err && (
          <p role="alert" className="text-sm text-rose-600">
            {err}
          </p>
        )}
        <FormError error={addTrade.error ?? delTrade.error} />
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {holding.trades.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <span className="inline-block w-24 text-slate-500">{x.date}</span>
                {TYPE_LABEL[x.type]}
                {x.units && ` ${formatUnits(x.units, holding.currency)} units`}
                {x.fees > 0 && <span className="text-slate-500"> · fees {money(x.fees)}</span>}
              </span>
              <span className="flex items-center gap-1">
                <span className="font-medium tabular-nums">{money(x.amount)}</span>
                <Button
                  variant="ghost"
                  aria-label={`Delete ${TYPE_LABEL[x.type].toLowerCase()} from ${x.date}`}
                  onClick={() =>
                    window.confirm(
                      `Delete the ${TYPE_LABEL[x.type].toLowerCase()} from ${x.date}?`,
                    ) && delTrade.mutate(x.id)
                  }
                >
                  <Trash2 size={14} aria-hidden />
                </Button>
              </span>
            </li>
          ))}
          {holding.trades.length === 0 && <li className="py-2 text-slate-500">No trades yet.</li>}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Prices</h3>
        <p className="text-xs text-slate-500">
          Enter the price per unit now and then (from your bank or broker). Without one, the last
          trade price is used.
        </p>
        <form
          className="grid grid-cols-[1fr_1fr_auto] items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!price) return setPriceErr('Enter the price per unit, e.g. 98,45');
            setPriceErr(null);
            addPrice.mutate({ date: p.date, price });
          }}
        >
          <Field label="Date" htmlFor="p-date">
            <Input
              id="p-date"
              type="date"
              required
              value={p.date}
              onChange={(e) => setP({ ...p, date: e.target.value })}
            />
          </Field>
          <Field label={`Price per unit (${holding.currency})`} htmlFor="p-price">
            <Input
              id="p-price"
              inputMode="decimal"
              placeholder="98,45"
              value={p.price}
              onChange={(e) => setP({ ...p, price: e.target.value })}
            />
          </Field>
          <Button type="submit" disabled={addPrice.isPending}>
            Save price
          </Button>
        </form>
        {priceErr && (
          <p role="alert" className="text-sm text-rose-600">
            {priceErr}
          </p>
        )}
        <FormError error={addPrice.error ?? delPrice.error} />
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {holding.prices.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-slate-500">{x.date}</span>
              <span className="flex items-center gap-1">
                <span className="tabular-nums">
                  {formatUnits(x.price, holding.currency)} {holding.currency}
                </span>
                <Button
                  variant="ghost"
                  aria-label={`Delete price from ${x.date}`}
                  onClick={() =>
                    window.confirm(`Delete the price from ${x.date}?`) && delPrice.mutate(x.id)
                  }
                >
                  <Trash2 size={14} aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
