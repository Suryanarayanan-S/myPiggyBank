/**
 * Investments, average-cost method. Units are micro-units (1 unit = 1 000 000) and prices are
 * micros of the currency per unit (€98.4567 = 98 456 700), so fractional shares and 4-decimal
 * prices stay exact. Money amounts are minor units (cents).
 */
export type Trade = {
  date: string;
  type: 'buy' | 'sell' | 'dividend';
  units: number;
  /** total paid (buy) or received (sell, dividend), minor units */
  amount: number;
  fees: number;
};
export type PricePoint = { date: string; price: number };

const B = BigInt;
/** round(n / d) half away from zero, for non-negative n and positive d */
const div = (n: bigint, d: bigint) => Number((n * 2n + d) / (2n * d));

/** units × price → minor units. */
export const valueOf = (units: number, price: number) => div(B(units) * B(price), 10_000_000_000n);

/** minor units ÷ units → micros per unit. */
const perUnit = (amount: number, units: number) => div(B(amount) * 10_000_000_000n, B(units));

export function computeHolding(trades: Trade[], prices: PricePoint[], today: string) {
  let units = 0;
  let cost = 0;
  let realised = 0;
  let dividends = 0;
  let last: { date: string; price: number } | null = null;
  // Stable sort keeps the given order for trades on the same day.
  for (const tr of [...trades]
    .filter((x) => x.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date))) {
    if (tr.type === 'dividend') {
      dividends += tr.amount;
      continue;
    }
    if (tr.units > 0) last = { date: tr.date, price: perUnit(tr.amount, tr.units) };
    if (tr.type === 'buy') {
      units += tr.units;
      cost += tr.amount + tr.fees;
    } else {
      const sold = Math.min(tr.units, units);
      const costOut = units === 0 ? 0 : div(B(cost) * B(sold), B(units));
      realised += tr.amount - tr.fees - costOut;
      cost -= costOut;
      units -= sold;
    }
  }
  const latest = prices
    .filter((p) => p.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const point = latest ?? last;
  const price = point?.price ?? null;
  const value =
    price === null ? (units === 0 && trades.length > 0 ? 0 : null) : valueOf(units, price);
  const unrealised = value === null ? null : value - cost;
  return {
    units,
    cost,
    avgCost: units === 0 ? null : perUnit(cost, units),
    price,
    priceDate: point?.date ?? null,
    priceSource: latest ? ('price' as const) : last ? ('trade' as const) : null,
    value,
    unrealised,
    returnBp: cost > 0 && unrealised !== null ? Math.round((unrealised * 10_000) / cost) : null,
    realised,
    dividends,
  };
}

/** Whether any sell, taken in date order, needs more units than are held at that point. */
export function oversold(trades: Trade[]): boolean {
  let units = 0;
  for (const tr of [...trades].sort((a, b) => a.date.localeCompare(b.date))) {
    if (tr.type === 'buy') units += tr.units;
    else if (tr.type === 'sell') {
      if (tr.units > units) return true;
      units -= tr.units;
    }
  }
  return false;
}
