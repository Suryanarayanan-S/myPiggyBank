import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Lock } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field, FormError } from '../ui/Field';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import {
  guessDateFormat,
  guessDecimal,
  rulePattern,
  type Analysis,
  type CsvPreview,
  type DateFormat,
} from '../../lib/bankImportTypes';
import { fileToBase64 } from '../../lib/files';
import { formatMoney } from '../../lib/money';
import { useAccounts, useCategories } from '../../lib/queries';
import { BUCKETS } from '../../lib/types';

type Choice = { include: boolean; categoryId: string; remember: boolean };

export function BankImport() {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const categories = useCategories();
  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [map, setMap] = useState({
    date: 0,
    payee: -1,
    description: -1,
    amount: 0,
    dateFormat: 'dd.mm.yyyy' as DateFormat,
    decimal: ',' as ',' | '.',
    invert: false,
  });
  const [accountId, setAccountId] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [result, setResult] = useState<number | null>(null);
  const account = active.find((a) => a.id === (accountId || active[0]?.id));

  const upload = useMutation({
    mutationFn: async (file: File) =>
      api.post<CsvPreview>('/import/csv/preview', {
        fileName: file.name,
        data: await fileToBase64(file),
      }),
    onMutate: () => (setPreview(null), setAnalysis(null), setResult(null)),
    onSuccess: (p) => {
      setPreview(p);
      const col = (i: number | null) => (i === null ? -1 : i);
      const sample = (i: number | null) =>
        i === null ? [] : p.rows.slice(0, 20).map((r) => r[i] ?? '');
      setMap({
        date: col(p.mapping.date) === -1 ? 0 : p.mapping.date!,
        payee: col(p.mapping.payee),
        description: col(p.mapping.description),
        amount: col(p.mapping.amount) === -1 ? 0 : p.mapping.amount!,
        dateFormat: guessDateFormat(sample(p.mapping.date)),
        decimal: guessDecimal(sample(p.mapping.amount)),
        invert: false,
      });
    },
  });

  const analyse = useMutation({
    mutationFn: () =>
      api.post<Analysis>('/import/csv/analyze', {
        accountId: account!.id,
        rows: preview!.rows,
        mapping: {
          ...map,
          payee: map.payee < 0 ? null : map.payee,
          description: map.description < 0 ? null : map.description,
        },
      }),
    onSuccess: (a) => {
      setAnalysis(a);
      setChoices(
        Object.fromEntries(
          a.rows.map((r) => [
            r.index,
            { include: !r.error && !r.duplicate, categoryId: r.suggestion ?? '', remember: true },
          ]),
        ),
      );
    },
  });

  const chosen = (analysis?.rows ?? []).filter((r) => !r.error && choices[r.index]?.include);
  const commit = useMutation({
    mutationFn: () => {
      const remember = new Map<string, string>();
      for (const r of chosen) {
        const c = choices[r.index]!;
        if (
          c.categoryId &&
          c.categoryId !== r.suggestion &&
          c.remember &&
          rulePattern(r.description).length >= 2
        ) {
          remember.set(rulePattern(r.description), c.categoryId);
        }
      }
      return api.post<{ created: number }>('/import/csv/commit', {
        accountId: account!.id,
        rows: chosen.map((r) => ({
          date: r.date,
          amount: r.amount,
          type: r.type,
          description: r.description,
          categoryId: choices[r.index]!.categoryId || null,
        })),
        rememberRules: [...remember].map(([pattern, categoryId]) => ({ pattern, categoryId })),
      });
    },
    onSuccess: async ({ created }) => {
      setResult(created);
      setAnalysis(null);
      setPreview(null);
      await queryClient.invalidateQueries();
    },
  });

  const headerOptions = useMemo(
    () => preview?.headers.map((h, i) => ({ i, label: h || `Column ${i + 1}` })) ?? [],
    [preview],
  );
  const colSelect = (
    id: string,
    label: string,
    key: 'date' | 'payee' | 'description' | 'amount',
    optional = false,
  ) => (
    <Field label={label} htmlFor={id}>
      <Select
        id={id}
        value={map[key]}
        onChange={(e) => setMap({ ...map, [key]: Number(e.target.value) })}
      >
        {optional && <option value={-1}>— none —</option>}
        {headerOptions.map((h) => (
          <option key={h.i} value={h.i}>
            {h.label}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-5">
      {result !== null && (
        <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40">
          <p className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 size={18} aria-hidden /> Imported {result} transactions.
          </p>
        </Card>
      )}
      <Card title="1 · Choose the bank statement">
        <label
          htmlFor="bank-file"
          className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-5 hover:border-indigo-400 dark:border-slate-700"
        >
          <FileText className="shrink-0 text-indigo-600" size={28} aria-hidden />
          <span className="text-sm">
            <span className="font-medium">
              {upload.isPending ? 'Reading…' : 'Choose a .csv file'}
            </span>
            <span className="block text-slate-500">
              e.g. the “CSV-CAMT” or “CSV-MT940” export from Sparkasse online banking
            </span>
          </span>
          <input
            id="bank-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = '';
            }}
          />
        </label>
        <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <Lock size={14} aria-hidden /> Read on this laptop only. The file itself is not stored.
        </p>
        <FormError error={upload.error} />
      </Card>

      {preview && (
        <Card title="2 · Columns">
          <p className="mb-3 text-sm text-slate-500">
            {preview.rows.length} rows found. Check which column holds what; the first row is shown
            below.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {colSelect('map-date', 'Date', 'date')}
            {colSelect('map-payee', 'Payee', 'payee', true)}
            {colSelect('map-description', 'Purpose / description', 'description', true)}
            {colSelect('map-amount', 'Amount', 'amount')}
            <Field label="Date format" htmlFor="map-dateformat">
              <Select
                id="map-dateformat"
                value={map.dateFormat}
                onChange={(e) => setMap({ ...map, dateFormat: e.target.value as DateFormat })}
              >
                {(['dd.mm.yyyy', 'dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd'] as const).map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </Select>
            </Field>
            <Field label="Decimal separator" htmlFor="map-decimal">
              <Select
                id="map-decimal"
                value={map.decimal}
                onChange={(e) => setMap({ ...map, decimal: e.target.value as ',' | '.' })}
              >
                <option value=",">Comma (52,40)</option>
                <option value=".">Point (52.40)</option>
              </Select>
            </Field>
            <Field label="Import into account" htmlFor="map-account">
              <Select
                id="map-account"
                value={account?.id ?? ''}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {active.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={map.invert}
                onChange={(e) => setMap({ ...map, invert: e.target.checked })}
              />
              Spending is shown as positive numbers
            </label>
          </div>
          {preview.rows[0] && (
            <p className="mt-3 truncate rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800">
              First row: {preview.rows[0].join(' | ')}
            </p>
          )}
          <FormError error={analyse.error} />
          <div className="mt-4">
            <Button disabled={!account || analyse.isPending} onClick={() => analyse.mutate()}>
              {analyse.isPending ? 'Checking…' : 'Check rows'}
            </Button>
          </div>
        </Card>
      )}

      {analysis && (
        <Card
          title="3 · Review"
          actions={
            <span className="text-sm text-slate-500">
              {analysis.summary.valid} readable · {analysis.summary.duplicates} already there ·{' '}
              {analysis.summary.invalid} unreadable
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-2 font-medium">
                    <span className="sr-only">Import</span>
                  </th>
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Description</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                  <th className="py-2 pl-3 font-medium">Category</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.map((r) => {
                  const c = choices[r.index];
                  const cats = (categories.data ?? []).filter((x) => x.kind === r.type);
                  return (
                    <tr
                      key={r.index}
                      className={clsx(
                        'border-t border-slate-100 dark:border-slate-800',
                        (!c?.include || r.error) && 'text-slate-400',
                      )}
                    >
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Import row ${r.index + 1}`}
                          disabled={!!r.error}
                          checked={!!c?.include && !r.error}
                          onChange={(e) =>
                            setChoices({
                              ...choices,
                              [r.index]: { ...c!, include: e.target.checked },
                            })
                          }
                        />
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{r.date ?? '—'}</td>
                      <td className="max-w-80 py-2 pr-3">
                        <span className="block truncate" title={r.description}>
                          {r.description}
                        </span>
                        {r.error && <span className="text-xs text-rose-600">{r.error}</span>}
                        {r.duplicate === 'existing' && (
                          <span className="text-xs text-amber-600">Already in this account</span>
                        )}
                        {r.duplicate === 'file' && (
                          <span className="text-xs text-amber-600">Appears twice in the file</span>
                        )}
                      </td>
                      <td
                        className={clsx(
                          'py-2 text-right whitespace-nowrap tabular-nums',
                          r.type === 'income' &&
                            !r.error &&
                            'text-emerald-600 dark:text-emerald-400',
                        )}
                      >
                        {r.amount === null
                          ? '—'
                          : `${r.type === 'income' ? '+' : '−'}${formatMoney(r.amount, account?.currency ?? 'EUR')}`}
                      </td>
                      <td className="py-2 pl-3">
                        {!r.error && (
                          <div className="flex items-center gap-2">
                            <Select
                              aria-label={`Category for row ${r.index + 1}`}
                              className="!py-1"
                              value={c?.categoryId ?? ''}
                              onChange={(e) =>
                                setChoices({
                                  ...choices,
                                  [r.index]: { ...c!, categoryId: e.target.value },
                                })
                              }
                            >
                              <option value="">Uncategorised</option>
                              {r.type === 'expense'
                                ? (Object.keys(BUCKETS) as (keyof typeof BUCKETS)[]).map((b) => (
                                    <optgroup key={b} label={BUCKETS[b]}>
                                      {cats
                                        .filter((x) => x.bucket === b)
                                        .map((x) => (
                                          <option key={x.id} value={x.id}>
                                            {x.name}
                                          </option>
                                        ))}
                                    </optgroup>
                                  ))
                                : cats.map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.name}
                                    </option>
                                  ))}
                            </Select>
                            {c?.categoryId && c.categoryId !== r.suggestion && (
                              <label
                                className="flex items-center gap-1 text-xs whitespace-nowrap text-slate-500"
                                title={`Next time, use this category for “${rulePattern(r.description)}”`}
                              >
                                <input
                                  type="checkbox"
                                  checked={c.remember}
                                  onChange={(e) =>
                                    setChoices({
                                      ...choices,
                                      [r.index]: { ...c, remember: e.target.checked },
                                    })
                                  }
                                />
                                Remember
                              </label>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <FormError error={commit.error} />
          <div className="mt-4">
            <Button
              disabled={chosen.length === 0 || commit.isPending}
              onClick={() => commit.mutate()}
            >
              {commit.isPending
                ? 'Importing…'
                : `Import ${chosen.length} transaction${chosen.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
