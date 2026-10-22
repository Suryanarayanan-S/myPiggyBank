import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { fileToBase64 } from '../../lib/files';
import { formatMoney } from '../../lib/money';
import { useMembers } from '../../lib/queries';

type Preview = {
  kind: 'dividend' | 'interest';
  rows: {
    symbol: string;
    date: string;
    amount: number;
    status: 'new' | 'recorded';
    held: boolean;
  }[];
  total: number;
  toAdd: { count: number; amount: number };
  newHoldings: string[];
  heldByOthers: string[];
  errors: { line: number; symbol: string; message: string }[];
};
type Result = { kind: Preview['kind']; added: number; skipped: number; newHoldings: string[] };
type Request = { fileName: string; data: string; ownerMemberId: string | null };

const inr = (paise: number) => formatMoney(paise, 'INR');
const WORD = {
  dividend: ['dividend', 'dividends'],
  interest: ['interest payment', 'interest payments'],
};
const many = (kind: Preview['kind'], n: number) => `${n} ${WORD[kind][n === 1 ? 0 : 1]}`;

/** Brings in Zerodha Console's dividend or interest report for one person. */
export function IncomeImport({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const members = useMembers();
  const [file, setFile] = useState<{ fileName: string; data: string } | null>(null);
  // undefined: not chosen yet (the logged-in person); null: shared.
  const [owner, setOwner] = useState<string | null | undefined>(undefined);
  const [readError, setReadError] = useState<string | null>(null);
  const done = useRef<HTMLButtonElement>(null);
  const ownerId = owner !== undefined ? owner : (members.data?.find((m) => m.isUser)?.id ?? null);
  const preview = useMutation({
    mutationFn: (body: Request) => api.post<Preview>('/holdings/income/preview', body),
  });
  const commit = useMutation({
    // Exactly the file and person that were previewed.
    mutationFn: (previewed: Request) => api.post<Result>('/holdings/income/commit', previewed),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['holdings'] }),
  });
  useEffect(() => {
    if (commit.data) done.current?.focus();
  }, [commit.data]);
  const run = (next: { fileName: string; data: string } | null, who: string | null) => {
    if (next) preview.mutate({ ...next, ownerMemberId: who });
  };
  const p = preview.data;

  if (commit.data) {
    const r = commit.data;
    return (
      <div className="space-y-4">
        <p className="text-sm">
          Done: {many(r.kind, r.added)} recorded
          {r.skipped ? `, ${r.skipped} already there` : ''}.
          {r.newHoldings.length > 0 &&
            ` For shares no longer held, archived holdings were added: ${r.newHoldings.join(', ')}.`}
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
        In Zerodha Console open Reports → Dividends (or Interest, for gold bonds) and download the
        CSV. Payouts already recorded are skipped, so a report can be imported again.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Whose demat is this?" htmlFor="inc-owner">
          <Select
            id="inc-owner"
            value={ownerId ?? ''}
            onChange={(e) => {
              const who = e.target.value || null;
              setOwner(who);
              run(file, who);
            }}
          >
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value="">Shared</option>
          </Select>
        </Field>
        <Field label="Dividend or interest report (CSV)" htmlFor="inc-file">
          <input
            id="inc-file"
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
                run(next, ownerId);
              } catch {
                setReadError('This file could not be read. Download it again from Console.');
              }
            }}
          />
        </Field>
      </div>
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
            <strong>{many(p.kind, p.rows.length)}</strong> · {inr(p.total)}
            <span className="block text-xs text-slate-500">
              {p.toAdd.count === 0
                ? 'All of them are already recorded.'
                : `${many(p.kind, p.toAdd.count)} to record (${inr(p.toAdd.amount)})` +
                  (p.rows.length - p.toAdd.count
                    ? `, ${p.rows.length - p.toAdd.count} already recorded`
                    : '') +
                  '.'}
            </span>
          </p>
          {p.heldByOthers.length > 0 && (
            <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
              Some of these shares belong to {p.heldByOthers.join(', ')}, not to the person chosen
              above. Check “Whose demat is this?” before recording.
            </p>
          )}
          {p.newHoldings.length > 0 && (
            <p className="text-xs text-slate-500">
              Not among the holdings (sold since): {p.newHoldings.join(', ')}. Their payouts go on
              archived holdings, so the year’s income adds up.
            </p>
          )}
          {p.errors.length > 0 && (
            <ul className="text-xs text-amber-700 dark:text-amber-400">
              {p.errors.map((e) => (
                <li key={e.line}>
                  Line {e.line} ({e.symbol}): {e.message} — left out.
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button
              disabled={p.toAdd.count === 0 || commit.isPending || !file}
              onClick={() => file && commit.mutate({ ...file, ownerMemberId: ownerId })}
            >
              {p.toAdd.count === 0 ? 'Nothing to record' : `Record ${many(p.kind, p.toAdd.count)}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
