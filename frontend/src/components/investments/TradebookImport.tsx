import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { api } from '../../lib/api';
import { checkDividends } from './DividendCheck';
import { dayLabel } from '../../lib/deposits';
import { fileToBase64 } from '../../lib/files';
import { DematPicker, useDematChoice, type Demat } from './DematPicker';

type Action =
  'replace' | 'history' | 'mismatch' | 'not-held' | 'elsewhere' | 'oversold' | 'several';
type Preview = {
  trades: number;
  from: string | null;
  to: string | null;
  symbols: {
    symbol: string;
    trades: number;
    fileUnits: string;
    heldUnits: string;
    action: Action;
    reason: string;
  }[];
  /** nothing in the demat yet */
  fresh: boolean;
  notInFile: string[];
  errors: { line: number; symbol: string; message: string }[];
};
type Result = { replaced: number; history: number; added: number; skipped: number };
type Request = { fileName: string; data: string } & Demat;

/** Brings in a full tradebook (Zerodha Console's format): real buy and sell dates. */
export function TradebookImport({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<{ fileName: string; data: string } | null>(null);
  const [demat, setDemat, ready] = useDematChoice();
  const [readError, setReadError] = useState<string | null>(null);
  const done = useRef<HTMLButtonElement>(null);
  // Symbols the demat does not hold yet: added when asked (at once for an empty demat).
  const [addMissing, setAddMissing] = useState(false);
  const preview = useMutation({
    mutationFn: (body: Request) => api.post<Preview>('/holdings/tradebook/preview', body),
  });
  const commit = useMutation({
    mutationFn: (previewed: Request) =>
      api.post<Result>('/holdings/tradebook/commit', { ...previewed, addMissing }),
    // trades change investments, net worth and goals; and the dividends of the shares held then
    onSuccess: () => {
      void queryClient.invalidateQueries();
      checkDividends(queryClient).catch(() => {});
    },
  });
  useEffect(() => setAddMissing(preview.data?.fresh ?? false), [preview.data]);
  useEffect(() => {
    if (commit.data) done.current?.focus();
  }, [commit.data]);
  const run = (next: { fileName: string; data: string } | null, where: Demat) => {
    if (next) preview.mutate({ ...next, ...where });
  };
  const p = preview.data;
  const of = (a: Action) => p?.symbols.filter((s) => s.action === a) ?? [];
  const replace = of('replace');
  const history = of('history');
  const missing = of('not-held');
  const adding = addMissing ? missing : [];
  // the ones not held are listed at their checkbox
  const left =
    p?.symbols.filter((s) => !['replace', 'history', 'not-held'].includes(s.action)) ?? [];
  const count = replace.length + history.length + adding.length;

  if (commit.data) {
    const r = commit.data;
    return (
      <div className="space-y-4">
        <p className="text-sm">
          Done: {r.replaced} holdings got their trades
          {r.added ? `, ${r.added} new holdings were added` : ''}, {r.history} sold ones were added
          as archived holdings{r.skipped ? `, ${r.skipped} left out` : ''}.
          {r.added > 0 &&
            ' New holdings show their last trade price until the next price update (or “Update now” under daily closing prices).'}
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
        In Zerodha Console open Reports → Tradebook and download the CSV (a combined file in the
        same columns works too). Each holding the file adds up to gets its real buy and sell dates;
        then its dividends and gold bond interest are worked out from NSE. Importing again changes
        nothing.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <DematPicker
          id="tb-demat"
          value={demat}
          onChange={(d) => {
            setDemat(d);
            run(file, d);
          }}
        />
        <Field label="Tradebook (CSV)" htmlFor="tb-file">
          <input
            id="tb-file"
            type="file"
            accept=".csv,text/csv"
            disabled={!ready}
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
                run(next, demat);
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
            <strong>{p.trades} trades</strong>
            {p.from && p.to && ` · ${dayLabel(p.from)} to ${dayLabel(p.to)}`}
            <span className="block text-xs text-slate-500">
              {replace.length} holdings get their real trades
              {adding.length > 0 && ` · ${adding.length} added as new holdings`} · {history.length}{' '}
              bought and sold entirely (added as archived holdings)
            </span>
          </p>
          {missing.length > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={addMissing}
                onChange={(e) => setAddMissing(e.target.checked)}
              />
              <span>
                Add {missing.length === 1 ? 'the 1 holding' : `the ${missing.length} holdings`} this
                demat does not have yet
                <span className="block text-xs text-slate-500">
                  {missing.length <= 8
                    ? missing.map((s) => `${s.symbol} (${s.fileUnits})`).join(', ')
                    : `${missing
                        .slice(0, 8)
                        .map((s) => s.symbol)
                        .join(', ')} and ${missing.length - 8} more`}
                  . Their count comes from the file
                  {p.from ? `, which starts ${dayLabel(p.from)}` : ''}: leave this off if their
                  first buys are earlier.
                </span>
              </span>
            </label>
          )}
          {left.length > 0 && (
            <div className="text-xs text-amber-800 dark:text-amber-300">
              <p className="font-medium">Left as they are:</p>
              <ul className="mt-1 space-y-0.5">
                {left.map((s) => (
                  <li key={s.symbol}>
                    {s.symbol}: {s.reason} (file {s.fileUnits}, held {s.heldUnits})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.notInFile.length > 0 && (
            <p className="text-xs text-slate-500">
              Held but not in the file (unchanged): {p.notInFile.join(', ')}.
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
              disabled={count === 0 || commit.isPending || !file}
              onClick={() => preview.variables && commit.mutate(preview.variables)}
            >
              {commit.isPending ? 'Importing…' : `Use the trades for ${count} holdings`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
