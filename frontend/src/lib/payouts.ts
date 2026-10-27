/** Dividends and interest, as the Dividends tab lists them (like Zerodha Console's report). */
export type Payout = {
  holdingId: string;
  symbol: string;
  name: string;
  ownerMemberId: string | null;
  /** ex-date (as the check records it), or the day entered by hand */
  date: string;
  kind: 'dividend' | 'interest';
  /** shares held the day before */
  units: number;
  /** rupees a share; null when none were held the day before */
  perShare: number | null;
  /** minor units of `currency` (paise, cents) */
  amount: number;
  currency: string;
};

export type PayoutKind = 'dividend' | 'interest' | 'all';
export type PayoutSort = 'symbol' | 'date' | 'units' | 'perShare' | 'amount';
export type Period = 'fy' | 'lastFy' | 'year' | 'all' | 'custom';

export function selectPayouts(
  rows: Payout[],
  o: {
    kind: PayoutKind;
    from: string | null;
    to: string | null;
    search: string;
    sort: PayoutSort;
    desc: boolean;
  },
): Payout[] {
  const q = o.search.trim().toLowerCase();
  const key = (r: Payout) => (o.sort === 'perShare' ? (r.perShare ?? -1) : r[o.sort]);
  return rows
    .filter(
      (r) =>
        (o.kind === 'all' || r.kind === o.kind) &&
        (!o.from || r.date >= o.from) &&
        (!o.to || r.date <= o.to) &&
        (!q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)),
    )
    .sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      const c =
        typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      // ties: newest first, then by symbol
      return (o.desc ? -c : c) || b.date.localeCompare(a.date) || a.symbol.localeCompare(b.symbol);
    });
}

/** The total in each currency (rupees first), and how many payouts. */
export function payoutTotals(rows: Payout[]) {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.currency, (sums.get(r.currency) ?? 0) + r.amount);
  const amounts = [...sums]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => Number(b.currency === 'INR') - Number(a.currency === 'INR'));
  return { amounts, count: rows.length };
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Console's columns ("Dividend per share" / "Interest per share"; plain words for both). */
export function payoutCsv(rows: Payout[], kind: PayoutKind): string {
  const word = kind === 'dividend' ? 'Dividend' : kind === 'interest' ? 'Interest' : null;
  const head = [
    'Symbol',
    'Ex-date',
    'Qty',
    word ? `${word} per share` : 'Per share',
    word ? `Total ${word.toLowerCase()}` : 'Total',
    // only when not all are in rupees (Console's report has none)
    ...(rows.some((r) => r.currency !== 'INR') ? ['Currency'] : []),
  ];
  return [
    head.join(','),
    ...rows.map((r) =>
      [
        cell(r.symbol),
        r.date,
        String(r.units),
        r.perShare === null ? '' : String(r.perShare),
        (r.amount / 100).toFixed(2),
        ...(head.length > 5 ? [r.currency] : []),
      ].join(','),
    ),
  ].join('\n');
}

const shift = (day: string, years: number) => `${Number(day.slice(0, 4)) + years}${day.slice(4)}`;

/** The days of a period up to `today` (null: no limit). India's financial year starts 1 April. */
export function rangeOf(period: Exclude<Period, 'custom'>, today: string) {
  const fyStart = `${today.slice(5) >= '04-01' ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01`;
  if (period === 'fy') return { from: fyStart, to: today };
  if (period === 'lastFy') return { from: shift(fyStart, -1), to: `${fyStart.slice(0, 4)}-03-31` };
  if (period === 'year') {
    // the day after the same day a year before (28 Feb for a 29 Feb)
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
    const from = new Date(Date.UTC(y - 1, m - 1, Math.min(d, last) + 1));
    return { from: from.toISOString().slice(0, 10), to: today };
  }
  return { from: null, to: null };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QUARTERS = ['Jan – Mar', 'Apr – Jun', 'Jul – Sep', 'Oct – Dec'];
const yy = (y: number) => String(y).slice(2);
/** months counted from year 0, so that a span is a subtraction */
const monthNo = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;

const STEPS = {
  month: { size: 1, label: (m: number) => `${MONTHS[m % 12]} ’${yy(Math.floor(m / 12))}` },
  quarter: {
    size: 3,
    label: (m: number) => `${QUARTERS[Math.floor((m % 12) / 3)]} ’${yy(Math.floor(m / 12))}`,
  },
  // India's financial year, April to March, as the periods above
  year: {
    size: 12,
    label: (m: number) => `FY ${Math.floor(m / 12)}-${yy(Math.floor(m / 12) + 1)}`,
  },
} as const;
/** where a bar starts: the month itself, its quarter's first month, its April */
const startOf = (m: number, step: keyof typeof STEPS) =>
  step === 'month' ? m : step === 'quarter' ? m - (m % 3) : m - ((m + 9) % 12);

/**
 * The payouts shown, added up per bar for the chart: by month for up to about a year, by quarter
 * up to four years, by financial year beyond. Every bar from `from` (or the first payout) to `to`
 * is drawn, empty ones too. One currency: the one with the most payouts; `others` are left out.
 */
export function payoutBars(rows: Payout[], from: string | null, to: string) {
  if (rows.length === 0) return null;
  const byCurrency = new Map<string, number>();
  for (const r of rows) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + 1);
  // the most payouts; on a tie rupees, then by name (not the table's order)
  const [currency] = [...byCurrency].sort(
    (a, b) =>
      b[1] - a[1] || Number(b[0] === 'INR') - Number(a[0] === 'INR') || a[0].localeCompare(b[0]),
  )[0]!;
  const mine = rows.filter((r) => r.currency === currency);
  const days = mine.map((r) => r.date).sort();
  // the days asked for, and any payout outside them (one dated ahead): every one gets its bar
  const first = Math.min(monthNo(from ?? days[0]!), monthNo(days[0]!));
  const last = Math.max(monthNo(to), monthNo(days.at(-1)!));
  const span = last - first + 1;
  const step: keyof typeof STEPS = span <= 13 ? 'month' : span <= 48 ? 'quarter' : 'year';
  const { size, label } = STEPS[step];
  const start = startOf(first, step);
  const bars = Array.from(
    { length: Math.floor((startOf(last, step) - start) / size) + 1 },
    (_, i) => ({
      key: String(start + i * size),
      label: label(start + i * size),
      dividend: 0,
      interest: 0,
    }),
  );
  for (const r of mine) {
    const bar = bars[Math.floor((startOf(monthNo(r.date), step) - start) / size)];
    if (bar) bar[r.kind] += r.amount;
  }
  return {
    step,
    currency,
    others: [...byCurrency.keys()].filter((c) => c !== currency).sort(),
    bars,
    total: mine.reduce((s, r) => s + r.amount, 0),
    count: mine.length,
  };
}
