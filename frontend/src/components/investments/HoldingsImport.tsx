import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { fileToBase64 } from '../../lib/files';
import { formatMoney } from '../../lib/money';
import { useMembers } from '../../lib/queries';

type Status = 'new' | 'more' | 'less' | 'same';
type Preview = {
  currency: string;
  rows: {
    symbol: string;
    kind: string;
    status: Status;
    unitsBefore: string | null;
    units: string;
    price: string;
    invested: number;
    value: number;
    /** Others who hold the same symbol (another demat). */
    alsoHeldBy: string[];
  }[];
  errors: { line: number; symbol: string; message: string }[];
  totals: { invested: number; value: number };
  missing: { symbol: string; name: string; units: string; value: number | null }[];
  assets: { id: string; name: string; value: number; suggested: boolean; goals: string[] }[];
};
type Result = { created: number; updated: number; unchanged: number; sold: number };
type Request = { fileName: string; data: string; ownerMemberId: string | null };

const STATUS: Record<Status, string> = {
  new: 'new',
  more: 'more units',
  less: 'fewer units',
  same: 'price update',
};

/** Brings in a Zerodha (Kite) holdings CSV for one person: preview, then create or update. */
export function HoldingsImport({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const members = useMembers();
  const [file, setFile] = useState<{ fileName: string; data: string } | null>(null);
  // undefined: not chosen yet (the logged-in person); null: shared.
  const [owner, setOwner] = useState<string | null | undefined>(undefined);
  const [retire, setRetire] = useState('');
  const [sellMissing, setSellMissing] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const done = useRef<HTMLButtonElement>(null);
  const ownerId = owner !== undefined ? owner : (members.data?.find((m) => m.isUser)?.id ?? null);

  const preview = useMutation({
    mutationFn: (body: Request) => api.post<Preview>('/holdings/import/preview', body),
  });
  // Worked out from the preview on screen (never a late answer for another person).
  useEffect(() => {
    const suggested = preview.data?.assets.filter((a) => a.suggested) ?? [];
    setRetire(suggested.length === 1 ? suggested[0]!.id : '');
    setSellMissing(false);
  }, [preview.data]);
  const commit = useMutation({
    // Exactly the file and person that were previewed.
    mutationFn: (previewed: Request) =>
      api.post<Result>('/holdings/import/commit', {
        ...previewed,
        retireAssetId: retire || null,
        sellMissing,
      }),
    // Holdings change investments, net worth and goals.
    onSuccess: () => queryClient.invalidateQueries(),
  });
  useEffect(() => {
    if (commit.data) done.current?.focus();
  }, [commit.data]);
  const run = (next: { fileName: string; data: string } | null, who: string | null) => {
    if (next) preview.mutate({ ...next, ownerMemberId: who });
  };
  const retiring = preview.data?.assets.find((a) => a.id === retire);

  const p = preview.data;
  const money = (c: number) => formatMoney(c, p?.currency ?? 'INR');
  const count = (s: Status) => p?.rows.filter((r) => r.status === s).length ?? 0;

  if (commit.data) {
    const r = commit.data;
    return (
      <div className="space-y-4">
        <p className="text-sm">
          Done: {r.created} new, {r.updated} updated
          {r.unchanged ? `, ${r.unchanged} unchanged` : ''}
          {r.sold ? `, ${r.sold} marked as sold` : ''}.
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
        In Zerodha Kite open Portfolio → Holdings and download the CSV. Import one file per person;
        a later file updates quantities and prices.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Whose demat is this?" htmlFor="imp-owner">
          <Select
            id="imp-owner"
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
        <Field label="Holdings file (CSV)" htmlFor="imp-file">
          <input
            id="imp-file"
            type="file"
            accept=".csv,text/csv"
            disabled={!members.data}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm dark:file:bg-slate-800"
            onChange={async (e) => {
              const input = e.target;
              const f = input.files?.[0];
              // Cleared so choosing the same file again (after exporting anew) reads it again.
              input.value = '';
              if (!f) return;
              setReadError(null);
              try {
                const next = { fileName: f.name, data: await fileToBase64(f) };
                setFile(next);
                run(next, ownerId);
              } catch {
                setReadError('This file could not be read. Download it again from Kite.');
              }
            }}
          />
        </Field>
      </div>
      <FormError error={preview.error} />
      {readError && (
        <p role="alert" className="text-sm text-rose-600">
          {readError}
        </p>
      )}
      <p aria-live="polite" className="text-sm text-slate-500 empty:hidden">
        {preview.isPending ? 'Reading the file…' : commit.data ? 'Import done.' : ''}
      </p>

      {p && (
        <>
          <p className="text-sm">
            <strong>{p.rows.length} holdings</strong> · invested {money(p.totals.invested)} · worth{' '}
            {money(p.totals.value)} at the file’s prices
            <span className="block text-xs text-slate-500">
              {[
                count('new') && `${count('new')} new`,
                count('more') && `${count('more')} with more units`,
                count('less') && `${count('less')} with fewer units`,
                count('same') && `${count('same')} only a new price`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </p>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <caption className="sr-only">Holdings in the file</caption>
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500 dark:bg-slate-800">
                <tr>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">
                    Symbol
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    Units
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    Worth
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-left font-medium">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {p.rows.map((r) => (
                  <tr key={r.symbol}>
                    <td className="px-3 py-1.5">{r.symbol}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.unitsBefore && r.unitsBefore !== r.units
                        ? `${r.unitsBefore} → ${r.units}`
                        : r.units}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(r.value)}</td>
                    <td className="px-3 py-1.5 text-xs text-slate-500">
                      {STATUS[r.status]}
                      {r.alsoHeldBy.length > 0 && (
                        <span className="block text-amber-700 dark:text-amber-400">
                          also held by {r.alsoHeldBy.join(', ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.errors.length > 0 && (
            <div role="alert" className="text-sm text-amber-700 dark:text-amber-400">
              {p.errors.length} row{p.errors.length > 1 ? 's' : ''} could not be read and will be
              skipped:
              <ul className="list-disc pl-5 text-xs">
                {p.errors.map((e) => (
                  <li key={e.line}>
                    line {e.line} ({e.symbol}): {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.missing.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="text-xs text-slate-500">
                Not in this file: {p.missing.map((m) => m.symbol).join(', ')}. They still count
                unless marked as sold.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sellMissing}
                  onChange={(e) => setSellMissing(e.target.checked)}
                />
                Mark them as sold today at their last price
              </label>
            </div>
          )}
          {p.assets.length > 0 && (
            <Field
              label="Already counted as a manual asset?"
              htmlFor="imp-retire"
              hint="Its value becomes 0 from today so net worth does not count the money twice; its history stays."
            >
              <Select id="imp-retire" value={retire} onChange={(e) => setRetire(e.target.value)}>
                <option value="">No, keep all assets as they are</option>
                {p.assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    Stop counting {a.name} ({money(a.value)})
                  </option>
                ))}
              </Select>
              {retiring && retiring.goals.length > 0 && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {retiring.name} counts towards {retiring.goals.join(', ')}: link the new holdings
                  to {retiring.goals.length > 1 ? 'those goals' : 'that goal'} instead.
                </p>
              )}
            </Field>
          )}
          <FormError error={commit.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onDone}>
              Cancel
            </Button>
            <Button
              disabled={p.rows.length === 0 || commit.isPending || !preview.variables}
              onClick={() => preview.variables && commit.mutate(preview.variables)}
            >
              {commit.isPending ? 'Importing…' : `Import ${p.rows.length} holdings`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
