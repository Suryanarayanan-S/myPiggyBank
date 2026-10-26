import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { api } from '../../lib/api';
import { checkDividends } from './DividendCheck';
import { dayLabel } from '../../lib/deposits';
import { fileToBase64 } from '../../lib/files';
import { DematPicker, useDematChoice, type Demat } from './DematPicker';

type Action = 'replace' | 'history' | 'mismatch' | 'not-held' | 'oversold' | 'several';
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
  notInFile: string[];
  errors: { line: number; symbol: string; message: string }[];
};
type Result = { replaced: number; history: number; skipped: number };
type Request = { fileName: string; data: string } & Demat;

/** Brings in a full tradebook (Zerodha Console's format): real buy and sell dates. */
export function TradebookImport({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<{ fileName: string; data: string } | null>(null);
  const [demat, setDemat, ready] = useDematChoice();
  const [readError, setReadError] = useState<string | null>(null);
  const done = useRef<HTMLButtonElement>(null);
  const preview = useMutation({
    mutationFn: (body: Request) => api.post<Preview>('/holdings/tradebook/preview', body),
  });
  const commit = useMutation({
    mutationFn: (previewed: Request) => api.post<Result>('/holdings/tradebook/commit', previewed),
    // trades change investments, net worth and goals; and the dividends of the shares held then
    onSuccess: () => {
      void queryClient.invalidateQueries();
      checkDividends(queryClient).catch(() => {});
    },
  });
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
  const left = p?.symbols.filter((s) => !['replace', 'history'].includes(s.action)) ?? [];

  if (commit.data) {
    const r = commit.data;
    return (
      <div className="space-y-4">
        <p className="text-sm">
          Done: {r.replaced} holdings got their trades, {r.history} sold ones were added as archived
          holdings{r.skipped ? `, ${r.skipped} left as they were` : ''}.
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
              {replace.length} holdings get their real trades · {history.length} bought and sold
              entirely (added as archived holdings)
            </span>
          </p>
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
              disabled={replace.length + history.length === 0 || commit.isPending || !file}
              onClick={() => preview.variables && commit.mutate(preview.variables)}
            >
              {commit.isPending
                ? 'Importing…'
                : `Use the trades for ${replace.length + history.length} holdings`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
