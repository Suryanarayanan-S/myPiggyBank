/**
 * The portfolio by demat account, like a broker's sub-account breakdown: what each demat (an
 * account of the type Investment) cost and is worth, and holdings outside any demat by person.
 */
import type { Holding } from './investments';
import { ranked } from './portfolio';

export type DematRow = {
  /** the demat's id, or "person:<member id>" ("person:" when shared) */
  key: string;
  accountId: string | null;
  ownerMemberId: string | null;
  /** summary currency: the money put in for the units held, and their worth now */
  cost: number;
  value: number;
  gain: number;
  returnBp: number | null;
  weightBp: number;
};

export function byDemat(holdings: Holding[], demats: Set<string>): DematRow[] {
  const sums = new Map<string, DematRow>();
  for (const r of ranked(holdings)) {
    const h = r.holding;
    const accountId = h.accountId && demats.has(h.accountId) ? h.accountId : null;
    const key = accountId ?? `person:${h.ownerMemberId ?? ''}`;
    const s = sums.get(key) ?? {
      key,
      accountId,
      ownerMemberId: h.ownerMemberId,
      cost: 0,
      value: 0,
      gain: 0,
      returnBp: null,
      weightBp: 0,
    };
    sums.set(key, { ...s, cost: s.cost + r.cost, value: s.value + r.value });
  }
  const total = [...sums.values()].reduce((t, s) => t + s.value, 0);
  return [...sums.values()]
    .map((s) => ({
      ...s,
      gain: s.value - s.cost,
      returnBp: s.cost > 0 ? Math.round(((s.value - s.cost) * 10_000) / s.cost) : null,
      weightBp: total > 0 ? Math.round((s.value * 10_000) / total) : 0,
    }))
    .sort((a, b) => b.value - a.value);
}
