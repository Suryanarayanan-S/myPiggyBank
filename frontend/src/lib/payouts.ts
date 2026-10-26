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
