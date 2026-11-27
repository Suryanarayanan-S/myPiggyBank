import { useId } from 'react';
import clsx from 'clsx';
import { Users } from 'lucide-react';
import { Ring } from '../charts/Ring';
import { Card } from '../ui/Card';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import {
  CLASSES,
  CLASS_COLOR,
  type AssetClass,
  type NetWorth,
  type NetWorthColumn,
} from '../../lib/wealthTypes';
import { Wealth } from './WealthOverview';

const CLASS_KEYS = Object.keys(CLASSES) as AssetClass[];

/** Who a column, an asset or a loan belongs to: the member, or "shared". */
export const ownerKey = (memberId: string | null) => memberId ?? 'shared';

/** A part of the whole in basis points; null when the whole is not above zero. */
const shareBp = (part: number, whole: number) =>
  whole > 0 ? Math.round((part * 10_000) / whole) : null;

/**
 * What the family's net worth is made of: a ring of the asset classes with what they add up to
 * in the middle, each class with its amount and share, and the loans taken off under them. A
 * class below zero (an overdrawn account) is left out of the shares, as the ring leaves it out.
 */
export function MadeOf({ c, className }: { c: NetWorth; className?: string }) {
  const parts = CLASS_KEYS.filter((k) => c.byClass[k] > 0).sort(
    (a, b) => c.byClass[b] - c.byClass[a],
  );
  const whole = parts.reduce((s, k) => s + c.byClass[k], 0);
  return (
    <Card title="Made of" className={clsx('flex flex-col', className)}>
      <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col">
        <div className="relative shrink-0">
          <Ring
            size={140}
            thickness={9}
            slices={parts.map((k) => ({ key: k, value: c.byClass[k], color: CLASS_COLOR[k] }))}
          />
          <p className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[11px] text-slate-500">Assets</span>
            <span className="text-base font-semibold tracking-tight">
              <Wealth cents={whole} currency={c.currency} />
            </span>
          </p>
        </div>
        <ul className="w-full min-w-0 flex-1 space-y-2 text-sm" aria-label="Assets by kind">
          {parts.map((k) => (
            <li key={k} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: CLASS_COLOR[k] }}
              />
              <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">
                {CLASSES[k]}
              </span>
              <span className="ml-auto font-medium">
                <Wealth cents={c.byClass[k]} currency={c.currency} />
              </span>
              <span className="w-12 text-right text-xs text-slate-500 tabular-nums">
                {formatPercent(shareBp(c.byClass[k], whole))}
              </span>
            </li>
          ))}
          {parts.length === 0 && <li className="text-slate-500">No assets yet.</li>}
        </ul>
      </div>
      {c.liabilities > 0 && (
        <div className="mt-auto border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="mt-3 flex items-center justify-between text-sm">
            <span className="text-slate-600 dark:text-slate-300">Loans</span>
            <span className="font-medium text-rose-600 dark:text-rose-400">
              −<Wealth cents={c.liabilities} currency={c.currency} />
            </span>
          </p>
          {c.debtRatioBp !== null && c.debtRatioBp >= 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {formatPercent(c.debtRatioBp)} of the assets (debt ratio)
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** Up to this many people sit around the family; more are listed (they would not fit). */
const MAX_AROUND = 6;
/** Half a node's width on wide screens (lg:w-48), to keep it inside the card. */
const HALF = 96;

/** Where each person's node sits around the family (in % of the box), starting top left. */
function spot(i: number, n: number) {
  const angle = -Math.PI * (n === 1 ? 0.5 : 0.75) + (i * 2 * Math.PI) / n;
  return { x: 50 + 37 * Math.cos(angle), y: 50 + 34 * Math.sin(angle) };
}

/**
 * The family as a tree: its net worth in the middle and each person (and what is shared) around
 * it with their net worth, share and a small ring of what theirs is made of. Choosing a person
 * shows their figures under the tree and only their assets and loans below; choosing them again
 * shows everyone's. On narrow screens (or with many people) it is a list.
 */
export function FamilyTree({
  c,
  selected,
  onSelect,
}: {
  c: NetWorth;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const glow = `tree${useId().replace(/:/g, '')}`;
  if (c.columns.length === 0) return null;
  const n = c.columns.length;
  const around = n <= MAX_AROUND;
  // shares of what the people with something to their name add up to (never over 100 %)
  const positive = c.columns.reduce((s, col) => s + Math.max(0, col.netWorth), 0);
  const chosen = c.columns.find((col) => ownerKey(col.memberId) === selected);
  const node = (col: NetWorthColumn, i: number) => {
    const key = ownerKey(col.memberId);
    const on = selected === key;
    const { x, y } = spot(i, n);
    const share = col.netWorth > 0 ? shareBp(col.netWorth, positive) : null;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        onClick={() => onSelect(on ? null : key)}
        style={
          around
            ? {
                left: `clamp(${HALF + 8}px, ${x}%, calc(100% - ${HALF + 8}px))`,
                top: `${y}%`,
              }
            : undefined
        }
        className={clsx(
          'flex items-center gap-3 rounded-2xl border bg-white p-3 text-left shadow-sm transition-colors dark:bg-slate-900',
          around && 'lg:absolute lg:w-48 lg:-translate-x-1/2 lg:-translate-y-1/2',
          on
            ? 'border-amber-400 ring-2 ring-amber-400/40 dark:border-amber-500'
            : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
        )}
      >
        <span className="relative shrink-0">
          <Ring
            size={46}
            thickness={10}
            slices={CLASS_KEYS.map((k) => ({ key: k, value: col[k], color: CLASS_COLOR[k] }))}
          />
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-slate-600 tabular-nums dark:text-slate-300"
          >
            {share === null ? '—' : `${Math.round(share / 100)}%`}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{col.name}</span>
          <span
            className={clsx(
              'block text-lg font-semibold tracking-tight',
              col.netWorth < 0 && 'text-rose-600 dark:text-rose-400',
            )}
          >
            <Wealth cents={col.netWorth} currency={c.currency} />
          </span>
          {share !== null && <span className="sr-only">{formatPercent(share)} of the family</span>}
        </span>
      </button>
    );
  };
  return (
    <section
      aria-label="Family members"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:bg-linear-to-b dark:from-white/[0.035] dark:to-transparent"
    >
      <div className={clsx('relative p-4', around && 'lg:h-96 lg:p-0')}>
        {/* the soft lines from the family to each person */}
        {around && (
          <svg
            aria-hidden
            className="absolute inset-0 hidden size-full lg:block"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <defs>
              <radialGradient id={glow} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="30" fill={`url(#${glow})`} />
            {c.columns.map((col, i) => {
              const { x, y } = spot(i, n);
              const on = selected === ownerKey(col.memberId);
              return (
                <line
                  key={ownerKey(col.memberId)}
                  x1="50"
                  y1="50"
                  x2={x}
                  y2={y}
                  stroke={on ? '#f59e0b' : 'currentColor'}
                  strokeOpacity={on ? 0.9 : 0.18}
                  strokeWidth={on ? 2 : 1.25}
                  strokeDasharray={on ? undefined : '4 4'}
                  vectorEffect="non-scaling-stroke"
                  className="text-slate-500"
                />
              );
            })}
          </svg>
        )}
        <div
          className={clsx(
            'mb-3 flex items-center gap-3',
            around &&
              'lg:absolute lg:top-1/2 lg:left-1/2 lg:mb-0 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:flex-col lg:gap-1 lg:text-center',
          )}
        >
          <span
            className={clsx(
              'flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 ring-1 ring-amber-500/30 dark:text-amber-400',
              around && 'lg:size-14',
            )}
          >
            <Users size={22} aria-hidden />
          </span>
          <span>
            <span className="block text-xs text-slate-500">The family</span>
            <span
              className={clsx(
                'block text-2xl font-semibold tracking-tight',
                c.netWorth < 0 && 'text-rose-600 dark:text-rose-400',
              )}
            >
              <Wealth cents={c.netWorth} currency={c.currency} />
            </span>
            <span aria-hidden className="block text-xs text-slate-500 tabular-nums">
              {formatMoney(c.netWorth, c.currency)}
            </span>
          </span>
        </div>
        <div className={clsx('grid grid-cols-1 gap-2 sm:grid-cols-2', around && 'lg:block')}>
          {c.columns.map(node)}
        </div>
      </div>
      {chosen ? (
        <div className="border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          <ul
            aria-label={`${chosen.name}: made of`}
            className="flex flex-wrap gap-x-5 gap-y-1 text-sm"
          >
            {CLASS_KEYS.filter((k) => chosen[k] !== 0).map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 rounded-sm"
                  style={{ background: CLASS_COLOR[k] }}
                />
                <span className="text-slate-600 dark:text-slate-300">{CLASSES[k]}</span>
                <span className="font-medium">
                  <Wealth cents={chosen[k]} currency={c.currency} />
                </span>
              </li>
            ))}
            {chosen.liabilities > 0 && (
              <li className="flex items-center gap-1.5">
                <span className="text-slate-600 dark:text-slate-300">Loans</span>
                <span className="font-medium text-rose-600 dark:text-rose-400">
                  −<Wealth cents={chosen.liabilities} currency={c.currency} />
                </span>
              </li>
            )}
          </ul>
        </div>
      ) : (
        <p className="border-t border-slate-100 px-5 py-2.5 text-center text-xs text-slate-500 dark:border-slate-800">
          Choose a person to see what theirs is made of
        </p>
      )}
    </section>
  );
}
