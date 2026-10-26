import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Pencil, Plus, Upload } from 'lucide-react';
import { useMe } from '../auth/auth';
import { HoldingActivity, HoldingForm } from '../components/investments/HoldingDialogs';
import { HoldingsImport } from '../components/investments/HoldingsImport';
import { CountAt } from '../components/investments/CountAt';
import { CorporateActions } from '../components/investments/CorporateActions';
import { IncomeChart } from '../components/investments/IncomeChart';
import { TradebookImport } from '../components/investments/TradebookImport';
import { DividendCheck } from '../components/investments/DividendCheck';
import { CorporateHistory } from '../components/investments/CorporateHistory';
import { Tile } from '../components/investments/Tiles';
import { LivePrices } from '../components/investments/LivePrices';
import { HoldingsList } from '../components/investments/HoldingsList';
import { PortfolioOverview } from '../components/investments/PortfolioOverview';
import { PayoutTable } from '../components/investments/PayoutTable';
import { SameMoney } from '../components/investments/SameMoney';
import { DematAccounts } from '../components/investments/DematAccounts';
import { ValueOverTime } from '../components/investments/ValueOverTime';
import { isSoldOut, listed, portfolioXirr, profitSplit } from '../lib/portfolio';
import { localDay } from '../lib/months';
import { dayLabel } from '../lib/deposits';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import {
  HOLDING_KINDS,
  formatPrice,
  formatUnits,
  gainClass,
  signed,
  type Holding,
  type HoldingsResponse,
} from '../lib/investments';
import { formatMoney } from '../lib/money';
import { formatPercent } from '../lib/percent';
import { useMembers } from '../lib/queries';
import { useViewCurrency, withView } from '../lib/viewCurrency';

const TABS = ['overview', 'performance', 'dividends', 'holdings'] as const;

export function InvestmentsPage() {
  const me = useMe();
  const members = useMembers();
  const [view] = useViewCurrency();
  const data = useQuery({
    queryKey: ['holdings', view],
    queryFn: () => api.get<HoldingsResponse>(withView('/holdings', view)),
  });
  const [dialog, setDialog] = useState<
    | { kind: 'form'; holding?: Holding }
    | { kind: 'activity'; id: string }
    | { kind: 'import' }
    | { kind: 'tradebook' }
    | null
  >(null);
  const close = () => setDialog(null);
  const owner = (id: string | null) =>
    id ? (members.data?.find((m) => m.id === id)?.name ?? 'Shared') : 'Shared';
  const s = data.data?.summary;
  // Memoised so the overview's value chart is only worked out again when the data changes.
  const open = useMemo(() => data.data?.holdings.filter((h) => !h.archived) ?? [], [data.data]);
  const archived = data.data?.holdings.filter((h) => h.archived) ?? [];
  const soldOut = open.filter(isSoldOut);
  const paidOut = (data.data?.holdings ?? []).some((h) =>
    h.trades.some((t) => t.type === 'dividend' || t.type === 'interest'),
  );
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t === params.get('tab')) ?? 'overview';
  const split = profitSplit(open);
  // the yearly return over every trade and payout (needs the trades' real dates: a tradebook)
  const xirr = useMemo(
    () => (data.data && s ? portfolioXirr(data.data.holdings, s.currency, localDay()) : null),
    [data.data, s],
  );
  const activity =
    dialog?.kind === 'activity' ? data.data?.holdings.find((h) => h.id === dialog.id) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Market</h1>
          <p className="text-sm text-slate-500">
            Shares, ETFs, funds and gold ETFs — from your trades and the prices you enter. They
            count in net worth as investments.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDialog({ kind: 'import' })}>
            <Upload size={16} aria-hidden /> Import from Zerodha
          </Button>
          <Button variant="secondary" onClick={() => setDialog({ kind: 'tradebook' })}>
            <Upload size={16} aria-hidden /> Import tradebook
          </Button>
          <Button onClick={() => setDialog({ kind: 'form' })}>
            <Plus size={16} aria-hidden /> Add holding
          </Button>
        </div>
      </div>
      <FormError error={data.error} />

      {s && open.length > 0 && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <CountAt />
            <LivePrices />
          </div>
          <CorporateActions holdings={open} onOpen={(id) => setDialog({ kind: 'activity', id })} />
          <div
            className={clsx('grid grid-cols-2 gap-3', xirr ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}
          >
            <Tile label="Value" value={formatMoney(s.value, s.currency)} />
            <Tile
              label="Invested"
              value={formatMoney(s.invested, s.currency)}
              hint="cost of what you hold"
            />
            <Tile
              label="Gain / loss"
              value={signed(s.unrealised, s.currency)}
              hint={[
                s.invested > 0
                  ? formatPercent(Math.round((s.unrealised * 10_000) / s.invested))
                  : null,
                `${split.profit} in profit · ${split.loss} in loss`,
              ]
                .filter(Boolean)
                .join(' · ')}
              tone={s.unrealised}
            />
            <Tile
              label="Dividends & interest"
              value={formatMoney(s.dividends, s.currency)}
              hint={`profit booked on sales: ${signed(s.realised, s.currency)}`}
            />
            {xirr && (
              <Tile
                label="XIRR"
                value={`${xirr.rate >= 0 ? '+' : ''}${formatPercent(Math.round(xirr.rate * 10_000))}`}
                hint={`a year, since ${dayLabel(xirr.since)}${
                  (data.data?.holdings ?? []).some((h) => h.currency !== s.currency)
                    ? ` (${s.currency} holdings only)`
                    : ''
                }`}
                tone={xirr.rate}
              />
            )}
          </div>
          {open.some((h) => h.currency !== s.currency) && (
            <p className="text-xs text-slate-500">
              Totals in {s.currency} use today’s exchange rates, also for past sales and dividends.
            </p>
          )}
          {s.unconverted.length > 0 && (
            <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              Not in the totals (no exchange rate to {s.currency}):{' '}
              {s.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
            </p>
          )}
          <div
            role="tablist"
            aria-label="Investments view"
            className="flex gap-1 border-b border-slate-200 dark:border-slate-800"
          >
            {(
              [
                ['overview', 'Overview'],
                ['performance', 'Performance'],
                ['dividends', 'Dividends'],
                ['holdings', `Holdings (${listed(open, s.currency).length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`panel-${key}`}
                onClick={() => setParams(key === 'overview' ? {} : { tab: key }, { replace: true })}
                className={clsx(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                  tab === key
                    ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Every panel exists (each tab points at one); the others are hidden. */}
          <div
            role="tabpanel"
            id="panel-overview"
            aria-labelledby="tab-overview"
            hidden={tab !== 'overview'}
            className="space-y-5"
          >
            <PortfolioOverview
              holdings={open}
              currency={s.currency}
              onOpen={(id) => setDialog({ kind: 'activity', id })}
            />
            <DematAccounts holdings={open} currency={s.currency} />
          </div>
          <div
            role="tabpanel"
            id="panel-performance"
            aria-labelledby="tab-performance"
            hidden={tab !== 'performance'}
            className="space-y-5"
          >
            <SameMoney holdings={open} />
            <ValueOverTime holdings={open} />
          </div>
          <div
            role="tabpanel"
            id="panel-dividends"
            aria-labelledby="tab-dividends"
            hidden={tab !== 'dividends'}
            className="space-y-5"
          >
            <DividendCheck empty={!paidOut} />
            <PayoutTable />
            {/* Sold holdings' payouts count too (archived ones included). */}
            <IncomeChart holdings={data.data?.holdings ?? []} currency={s.currency} />
            <CorporateHistory />
          </div>
          <div
            role="tabpanel"
            id="panel-holdings"
            aria-labelledby="tab-holdings"
            hidden={tab !== 'holdings'}
            className="space-y-5"
          >
            <HoldingsList holdings={open} currency={s.currency} owner={owner} onOpen={setDialog} />
            {/* Sold out: kept for their history; their value is out of the totals. */}
            {soldOut.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                  Sold
                </h2>
                <HoldingsTable list={soldOut} owner={owner} onOpen={setDialog} />
              </section>
            )}
          </div>
        </>
      )}

      {data.data && data.data.holdings.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No holdings yet. Add your ETFs, stocks or gold, then enter the buys from your depot
            statement. Recurring deposits, FDs and saving schemes fit better as assets on the Wealth
            page.
          </p>
        </Card>
      )}
      {archived.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Archived</h2>
          <HoldingsTable list={archived} owner={owner} onOpen={setDialog} />
        </section>
      )}

      {dialog?.kind === 'form' && (
        <Modal
          title={dialog.holding ? `Edit ${dialog.holding.name}` : 'New holding'}
          onClose={close}
        >
          <HoldingForm
            holding={dialog.holding}
            defaultCurrency={me.data?.family.spendingCurrency ?? 'EUR'}
            onDone={() => {
              // A new holding has no trades yet: show it in the list, where trades are added.
              if (!dialog.holding) setParams({ tab: 'holdings' }, { replace: true });
              close();
            }}
          />
        </Modal>
      )}
      {dialog?.kind === 'tradebook' && (
        <Modal title="Import tradebook" onClose={close}>
          <TradebookImport onDone={close} />
        </Modal>
      )}
      {dialog?.kind === 'import' && (
        <Modal title="Import holdings" onClose={close}>
          <HoldingsImport onDone={close} />
        </Modal>
      )}
      {activity && (
        <Modal title={`Trades · ${activity.name}`} onClose={close}>
          <HoldingActivity holding={activity} onDone={close} />
        </Modal>
      )}
    </div>
  );
}

/**
 * A holding sold out shows what the sales booked (a gain on ₹0 left says nothing), with the
 * dividends it paid; one still held its gain on paper.
 */
function gainOf(h: Holding) {
  const sold = Number(h.units) === 0 && h.trades.some((t) => t.type === 'sell');
  if (!sold) return { amount: h.unrealised, bp: h.returnBp, note: null };
  return {
    amount: h.realised,
    bp: h.realisedBp,
    note:
      h.dividends > 0 ? `booked · +${formatMoney(h.dividends, h.currency)} dividends` : 'booked',
  };
}

function Gain({ h }: { h: Holding }) {
  const g = gainOf(h);
  return (
    <span className={clsx('tabular-nums', gainClass(g.amount))}>
      {g.amount === null ? '—' : signed(g.amount, h.currency)}
      {g.bp !== null && <span className="block text-xs">{formatPercent(g.bp)}</span>}
      {g.note && <span className="block text-xs text-slate-500">{g.note}</span>}
    </span>
  );
}

function HoldingsTable({
  list,
  owner,
  onOpen,
}: {
  list: Holding[];
  owner: (id: string | null) => string;
  onOpen: (d: { kind: 'form'; holding: Holding } | { kind: 'activity'; id: string }) => void;
}) {
  return (
    <>
      {/* Phones: one card per holding (a 7-column table does not fit). */}
      <ul className="space-y-3 md:hidden">
        {list.map((h) => (
          <li key={h.id}>
            <Card className="!p-4">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => onOpen({ kind: 'activity', id: h.id })}
                >
                  <span className="block font-medium break-words">{h.name}</span>
                  <span className="block text-xs text-slate-500">
                    {HOLDING_KINDS[h.kind]} · {formatUnits(h.units, h.currency)} units ·{' '}
                    {owner(h.ownerMemberId)}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  aria-label={`Edit ${h.name}`}
                  onClick={() => onOpen({ kind: 'form', holding: h })}
                >
                  <Pencil size={16} aria-hidden />
                </Button>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <span className="text-lg font-semibold tabular-nums">
                  {h.value === null ? '—' : formatMoney(h.value, h.currency)}
                </span>
                <span className="text-right text-sm">
                  <Gain h={h} />
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>
                  {h.price ? `${formatPrice(h.price, h.currency)} ${h.currency}` : 'no price yet'}
                  {h.priceDate &&
                    ` · ${h.priceSource === 'trade' ? 'last trade ' : ''}${h.priceDate}`}
                </span>
                <Button
                  variant="secondary"
                  className="!py-1"
                  onClick={() => onOpen({ kind: 'activity', id: h.id })}
                >
                  Trades
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="hidden !p-0 md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
                <th className="px-4 py-2 font-medium">Holding</th>
                <th className="px-3 py-2 text-right font-medium">Units</th>
                <th className="px-3 py-2 text-right font-medium">Avg. cost</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-right font-medium">Gain / loss</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {list.map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      onClick={() => onOpen({ kind: 'activity', id: h.id })}
                    >
                      {h.name}
                    </button>
                    <span className="block text-xs text-slate-500">
                      {HOLDING_KINDS[h.kind]}
                      {h.symbol && ` · ${h.symbol}`} · {owner(h.ownerMemberId)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatUnits(h.units, h.currency)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {h.avgCost ? `${formatPrice(h.avgCost, h.currency)} ${h.currency}` : '—'}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {h.price ? `${formatPrice(h.price, h.currency)} ${h.currency}` : '—'}
                    {h.priceDate && (
                      <span className="block text-xs text-slate-500">
                        {h.priceSource === 'trade' ? 'last trade ' : ''}
                        {h.priceDate}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">
                    {h.value === null ? '—' : formatMoney(h.value, h.currency)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Gain h={h} />
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <Button
                      variant="secondary"
                      className="!py-1"
                      onClick={() => onOpen({ kind: 'activity', id: h.id })}
                    >
                      Trades
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Edit ${h.name}`}
                      onClick={() => onOpen({ kind: 'form', holding: h })}
                    >
                      <Pencil size={16} aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
