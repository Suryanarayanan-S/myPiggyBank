import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Lock } from 'lucide-react';
import { useMe } from '../auth/auth';
import { BankImport } from '../components/import/BankImport';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, FormError } from '../components/ui/Field';
import { Select } from '../components/ui/Select';
import { api } from '../lib/api';
import { fileToBase64 } from '../lib/files';
import { defaultImportMode, type ImportMode } from '../lib/importDefaults';
import { formatMoney } from '../lib/money';
import { monthTitle } from '../lib/months';
import { useAccounts, useCategories } from '../lib/queries';
import {
  BUCKETS,
  type Bucket,
  type ImportLabel,
  type ImportPreview,
  type ImportResult,
  type ImportSuggestion,
} from '../lib/types';

type Mode = ImportMode;
const encode = (s: ImportSuggestion) =>
  'categoryId' in s ? `c:${s.categoryId}` : `n:${s.newName}`;
const decode = (v: string): ImportSuggestion =>
  v.startsWith('c:') ? { categoryId: v.slice(2) } : { newName: v.slice(2) };
const CATCH_ALL: Record<Bucket, string> = {
  essentials: 'Other essentials',
  fun: 'Other fun',
  future: 'Other savings',
};

function SpreadsheetImport() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [account, setAccount] = useState('new');
  const [result, setResult] = useState<ImportResult | null>(null);
  const currency = me.data?.family.spendingCurrency ?? 'EUR';
  const targetAccounts = useAccountsIn(currency);

  const upload = useMutation({
    mutationFn: async (file: File) =>
      api.post<ImportPreview>('/import/spreadsheet/preview', {
        fileName: file.name,
        data: await fileToBase64(file),
      }),
    onSuccess: (p) => {
      setPreview(p);
      setResult(null);
      setMapping(Object.fromEntries(p.labels.map((l) => [l.key, encode(l.suggestion)])));
      setModes(Object.fromEntries(p.months.map((m) => [m.month, defaultImportMode(m.existing)])));
    },
  });

  const chosen = preview?.months.filter((m) => modes[m.month] !== 'skip') ?? [];
  const commit = useMutation({
    mutationFn: () =>
      api.post<ImportResult>('/import/spreadsheet/commit', {
        account: account === 'new' ? { newName: 'Spreadsheet history' } : { id: account },
        months: chosen.map((m) => ({
          month: m.month,
          sheet: m.sheet,
          mode: modes[m.month],
          income: m.income,
          items: m.items,
        })),
        mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, decode(v)])),
      }),
    onSuccess: async (r) => {
      setResult(r);
      setPreview(null);
      await queryClient.invalidateQueries();
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import spreadsheet</h1>
        <p className="mt-1 text-sm text-slate-500">
          Bring your monthly-spending workbook (one sheet per month) into myPiggyBank. You check
          everything before anything is saved.
        </p>
      </div>

      {result && <ResultCard result={result} />}

      <Card title="1 · Choose the workbook">
        <div className="space-y-3">
          <label
            htmlFor="import-file"
            className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 p-5 hover:border-indigo-400 dark:border-slate-700"
          >
            <FileSpreadsheet className="shrink-0 text-indigo-600" size={28} aria-hidden />
            <span className="text-sm">
              <span className="font-medium">
                {upload.isPending ? 'Reading…' : 'Choose an .xlsx file'}
              </span>
              <span className="block text-slate-500">e.g. “Surya - Monthly Spending.xlsx”</span>
            </span>
            <input
              id="import-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
          </label>
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Lock size={14} aria-hidden /> Read on this laptop only. The file itself is not stored.
          </p>
          <FormError error={upload.error} />
        </div>
      </Card>

      {preview && (
        <>
          <MappingCard
            preview={preview}
            mapping={mapping}
            setMapping={setMapping}
            currency={currency}
          />
          <Card title="3 · Months">
            {preview.skippedSheets.length > 0 && (
              <p className="mb-3 text-xs text-slate-500">
                Skipped sheets: {preview.skippedSheets.join(', ')}
              </p>
            )}
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {preview.months.map((m) => {
                const mode = modes[m.month] ?? 'import';
                return (
                  <li
                    key={m.month}
                    className="grid gap-2 py-3 sm:grid-cols-[10rem_1fr_auto] sm:items-center"
                  >
                    <div>
                      <p className="font-medium">{monthTitle(m.month)}</p>
                      <p className="text-xs text-slate-500">
                        sheet “{m.sheet}” · {m.income.length + m.items.length} rows
                      </p>
                    </div>
                    <div className="text-sm">
                      <p className="tabular-nums">
                        Income {formatMoney(m.parsedTotals.netIncome, currency)} · Spend{' '}
                        {formatMoney(m.parsedTotals.spend, currency)}
                      </p>
                      {m.matches ? (
                        <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 size={14} aria-hidden /> Matches the sheet’s own totals
                        </p>
                      ) : (
                        <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <AlertTriangle size={14} aria-hidden /> The sheet says income{' '}
                          {formatMoney(m.sheetTotals.netIncome ?? 0, currency)}, spend{' '}
                          {formatMoney(m.sheetTotals.spend ?? 0, currency)}
                        </p>
                      )}
                      {m.warnings.map((w) => (
                        <p key={w} className="text-xs text-amber-600 dark:text-amber-400">
                          {w}
                        </p>
                      ))}
                      {m.existing.imported > 0 && (
                        <p className="text-xs text-slate-500">Already imported earlier.</p>
                      )}
                      {m.existing.manual > 0 && (
                        <p className="text-xs text-slate-500">
                          {m.existing.manual} transaction{m.existing.manual > 1 ? 's' : ''} already
                          entered in the app this month, so this month is skipped by default.
                          Importing it would count both.
                        </p>
                      )}
                    </div>
                    <Select
                      aria-label={`What to do with ${monthTitle(m.month)}`}
                      className="!w-auto"
                      value={mode}
                      onChange={(e) => setModes({ ...modes, [m.month]: e.target.value as Mode })}
                    >
                      {m.existing.imported > 0 ? (
                        <>
                          <option value="skip">Skip</option>
                          <option value="replace">Replace earlier import</option>
                        </>
                      ) : (
                        <>
                          <option value="import">Import</option>
                          <option value="skip">Skip</option>
                        </>
                      )}
                    </Select>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="4 · Import">
            <div className="space-y-4">
              <Field label="Put the transactions into" htmlFor="import-account">
                <Select
                  id="import-account"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="new">A “Spreadsheet history” account (recommended)</option>
                  {targetAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="text-sm text-slate-500">
                Every month’s income and spending changes the chosen account’s balance. A separate
                history account keeps your real bank balances correct; its balance simply shows your
                total unused money over these months.
              </p>
              <FormError error={commit.error} />
              <Button
                disabled={chosen.length === 0 || commit.isPending}
                onClick={() => commit.mutate()}
              >
                {commit.isPending
                  ? 'Importing…'
                  : `Import ${chosen.length} month${chosen.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function useAccountsIn(currency: string) {
  const accounts = useAccounts();
  return (accounts.data ?? []).filter((a) => a.currency === currency && !a.archived);
}

function MappingCard({
  preview,
  mapping,
  setMapping,
  currency,
}: {
  preview: ImportPreview;
  mapping: Record<string, string>;
  setMapping: (m: Record<string, string>) => void;
  /** The spreadsheet's amounts are imported in the spending currency. */
  currency: string;
}) {
  const categories = useCategories();
  const groups = useMemo(
    () =>
      [
        { title: 'Income', filter: (l: ImportLabel) => l.kind === 'income' },
        ...(Object.keys(BUCKETS) as Bucket[]).map((b) => ({
          title: BUCKETS[b],
          filter: (l: ImportLabel) => l.bucket === b,
        })),
      ].map((g) => ({
        ...g,
        labels: preview.labels.filter(g.filter).sort((a, b) => b.total - a.total),
      })),
    [preview],
  );
  const newNames = new Set(
    Object.values(mapping)
      .filter((v) => v.startsWith('n:'))
      .map((v) => v.slice(2).toLowerCase()),
  );

  return (
    <Card
      title="2 · Categories"
      actions={
        <span className="text-sm text-slate-500">
          {preview.labels.length} labels · {newNames.size} new categor
          {newNames.size === 1 ? 'y' : 'ies'}
        </span>
      }
    >
      <p className="mb-4 text-sm text-slate-500">
        Each spreadsheet line becomes a transaction that keeps its label. Choose the category for
        each label; the suggestions are already filled in.
      </p>
      <div className="space-y-6">
        {groups
          .filter((g) => g.labels.length > 0)
          .map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {g.title}
              </h3>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {g.labels.map((l) => {
                  const options = (categories.data ?? []).filter(
                    (c) => c.kind === l.kind && (l.kind === 'income' || c.bucket === l.bucket),
                  );
                  const value = mapping[l.key] ?? '';
                  const newChoices = [
                    ...(l.bucket ? [CATCH_ALL[l.bucket]] : []),
                    l.label.charAt(0).toUpperCase() + l.label.slice(1),
                  ].filter((n) => !options.some((c) => c.name.toLowerCase() === n.toLowerCase()));
                  if (value.startsWith('n:') && !newChoices.includes(value.slice(2)))
                    newChoices.unshift(value.slice(2));
                  return (
                    <li
                      key={l.key}
                      className="grid gap-2 py-2 sm:grid-cols-[1fr_auto_16rem] sm:items-center"
                    >
                      <span className="min-w-0 text-sm">
                        <span className="block truncate font-medium">{l.label}</span>
                        <span className="text-xs text-slate-500">
                          {l.occurrences} month{l.occurrences > 1 ? 's' : ''}
                        </span>
                      </span>
                      <span className="text-sm tabular-nums text-slate-500">
                        {formatMoney(l.total, currency)}
                      </span>
                      <Select
                        aria-label={`Category for ${l.label}`}
                        value={value}
                        className={clsx(
                          value.startsWith('n:') && 'border-indigo-300 dark:border-indigo-800',
                        )}
                        onChange={(e) => setMapping({ ...mapping, [l.key]: e.target.value })}
                      >
                        {options.map((c) => (
                          <option key={c.id} value={`c:${c.id}`}>
                            {c.name}
                          </option>
                        ))}
                        {newChoices.map((n) => (
                          <option key={n} value={`n:${n}`}>
                            New category: {n}
                          </option>
                        ))}
                      </Select>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
      </div>
    </Card>
  );
}

function ResultCard({ result }: { result: ImportResult }) {
  const first = result.months[0];
  const last = result.months.at(-1);
  return (
    <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40">
      <p className="flex items-start gap-2 text-sm text-emerald-800 dark:text-emerald-300">
        <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Imported {result.created} transactions across {result.months.length} months
          {result.newCategories.length > 0 &&
            ` and created ${result.newCategories.join(', ')}`}.{' '}
          {first && (
            <Link to={`/budget?month=${first}`} className="font-medium underline">
              Open {monthTitle(first)}
            </Link>
          )}
          {last && last !== first && (
            <>
              {' · '}
              <Link to={`/budget?month=${last}`} className="font-medium underline">
                Open {monthTitle(last)}
              </Link>
            </>
          )}
        </span>
      </p>
    </Card>
  );
}

export function ImportPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'bank' ? 'bank' : 'spreadsheet';
  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label="Import type"
        className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
      >
        {(
          [
            ['spreadsheet', 'Monthly spreadsheet'],
            ['bank', 'Bank statement (CSV)'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setParams(value === 'bank' ? { tab: 'bank' } : {}, { replace: true })}
            className={clsx(
              'rounded-md px-3 py-1.5 text-sm font-medium',
              tab === value ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-slate-500',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'bank' ? <BankImport /> : <SpreadsheetImport />}
    </div>
  );
}
