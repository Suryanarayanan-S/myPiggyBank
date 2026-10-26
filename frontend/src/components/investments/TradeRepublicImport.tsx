import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { dayLabel } from '../../lib/deposits';
import { fileToBase64 } from '../../lib/files';
import { useMembers } from '../../lib/queries';
import { NewDematForm, useDemats } from './DematPicker';

type Status = 'new' | 'held' | 'oversold';
type Preview = {
  currency: string;
  from: string | null;
  to: string | null;
  holdings: {
    isin: string;
    name: string;
    status: Status;
    trades: number;
    dividends: number;
    known: number;
    units: string;
  }[];
  skipped: Record<string, number>;
  errors: { line: number; name: string; message: string }[];
};
type Result = { created: number; added: number; known: number };
type Request = { fileName: string; data: string; accountId: string };

const CURRENCY = 'EUR';
const STATUS: Record<Status, string> = {
  new: 'new holding',
  held: 'held',
  oversold: 'sells more than the account holds (a row is missing) — left out',
};

/**
 * Trade Republic's transactions export into a broker account in euros: buys, sells and
 * dividends (with the tax withheld), each row once — a later export that overlaps adds only
 * what is new.
 */
export function TradeRepublicImport({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const members = useMembers();
  const accounts = useDemats().filter((a) => a.currency === CURRENCY);
  const [chosen, setChosen] = useState<string | null>(null);
  // the logged-in person's first one until another is chosen
  const me = members.data?.find((m) => m.isUser)?.id ?? null;
  const accountId =
    chosen ?? (accounts.find((a) => a.ownerMemberId === me) ?? accounts[0])?.id ?? null;
  const [adding, setAdding] = useState(false);
  const [file, setFile] = useState<{ fileName: string; data: string } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const done = useRef<HTMLButtonElement>(null);
  const preview = useMutation({
    mutationFn: (body: Request) => api.post<Preview>('/holdings/trade-republic/preview', body),
  });
  const commit = useMutation({
    mutationFn: (previewed: Request) =>
      api.post<Result>('/holdings/trade-republic/commit', previewed),
    // holdings change investments, net worth and goals
    onSuccess: () => queryClient.invalidateQueries(),
  });
  useEffect(() => {
    if (commit.data) done.current?.focus();
  }, [commit.data]);
  // previewed as soon as there are both a file and an account (in whichever order they come)
  const { mutate } = preview;
  useEffect(() => {
    if (file && accountId) mutate({ ...file, accountId });
  }, [file, accountId, mutate]);
  const owner = (id: string | null) =>
    id ? (members.data?.find((m) => m.id === id)?.name ?? '—') : 'Shared';
  const p = preview.data;
  const importing = p?.holdings.filter((h) => h.status !== 'oversold') ?? [];
  const rows = importing.reduce((n, h) => n + h.trades + h.dividends, 0);
  const skipped = Object.entries(p?.skipped ?? {});

  if (commit.data) {
    const r = commit.data;
    return (
      <div className="space-y-4">
        <p className="text-sm">
          Done: {r.added} rows imported{r.created ? `, ${r.created} new holdings` : ''}
          {r.known ? `, ${r.known} imported before` : ''}. With daily prices on, they get their
          prices (and any split) from onvista each day.
        </p>
        <div className="flex justify-end">
          <Button ref={done} onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        In the Trade Republic app open Profile → Transactions and export them as CSV. Buys, sells
        and dividends come in; transfers, interest and card payments are left out. Importing a newer
        export adds only what is new.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Which account is this?"
          htmlFor="trp-account"
          hint="An investment account in euros; its owner’s holdings."
        >
          <Select
            id="trp-account"
            value={adding ? 'new' : (accountId ?? 'new')}
            onChange={(e) => {
              if (e.target.value === 'new') return setAdding(true);
              setAdding(false);
              setChosen(e.target.value);
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {owner(a.ownerMemberId)}
              </option>
            ))}
            <option value="new">New broker account…</option>
          </Select>
        </Field>
        <Field label="Transactions export (CSV)" htmlFor="trp-file">
          <input
            id="trp-file"
            type="file"
            accept=".csv,text/csv"
            disabled={!members.data}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-slate-800"
            onChange={async (e) => {
              const input = e.target;
              const f = input.files?.[0];
              input.value = '';
              if (!f) return;
              setReadError(null);
              try {
                const next = { fileName: f.name, data: await fileToBase64(f) };
                setFile(next);
              } catch {
                setReadError('This file could not be read. Export it again from the app.');
              }
            }}
          />
        </Field>
      </div>
      {(adding || (members.data && accounts.length === 0)) && (
        <NewDematForm
          currency={CURRENCY}
          onCancel={() => setAdding(false)}
          onCreated={(a) => {
            setAdding(false);
            setChosen(a.id);
          }}
        />
      )}
      <FormError error={preview.error ?? commit.error} />
      {readError && (
        <p role="alert" className="text-sm text-rose-600">
          {readError}
        </p>
      )}
      <p aria-live="polite" className="text-sm text-slate-500 empty:hidden">
        {preview.isPending ? 'Reading the file…' : ''}
      </p>
      {p && (
        <>
          <p className="text-sm">
            <strong>
              {p.holdings.length} {p.holdings.length === 1 ? 'security' : 'securities'}
            </strong>
            {p.from && p.to && ` · ${dayLabel(p.from)} to ${dayLabel(p.to)}`}
          </p>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {p.holdings.map((h) => (
              <li key={h.isin} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                <span>
                  <span className="font-medium">{h.name}</span>{' '}
                  <span className="text-xs text-slate-500">{h.isin}</span>
                </span>
                <span
                  className={
                    h.status === 'oversold'
                      ? 'text-xs text-amber-700 dark:text-amber-400'
                      : 'text-xs text-slate-500'
                  }
                >
                  {h.status === 'oversold'
                    ? STATUS.oversold
                    : `${STATUS[h.status]} · ${h.trades} trades, ${h.dividends} dividends new${
                        h.known ? `, ${h.known} imported before` : ''
                      } · ${h.units} shares`}
                </span>
              </li>
            ))}
          </ul>
          {skipped.length > 0 && (
            <p className="text-xs text-slate-500">
              Left out: {skipped.map(([type, n]) => `${n} × ${type.toLowerCase()}`).join(', ')}.
            </p>
          )}
          {p.errors.length > 0 && (
            <ul className="text-xs text-amber-700 dark:text-amber-400">
              {p.errors.map((e) => (
                <li key={e.line}>
                  Line {e.line} ({e.name}): {e.message} — left out.
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button
              disabled={rows === 0 || commit.isPending}
              onClick={() => preview.variables && commit.mutate(preview.variables)}
            >
              {commit.isPending
                ? 'Importing…'
                : rows === 0
                  ? 'Nothing new to import'
                  : `Import ${rows} ${rows === 1 ? 'row' : 'rows'}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
