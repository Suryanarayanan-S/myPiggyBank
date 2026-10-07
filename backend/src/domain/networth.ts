import { convert, type Rate } from './currency.js';

export const ASSET_CLASSES = ['liquid', 'property', 'investment', 'other'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];
type ByClass = Record<AssetClass, number>;

type Owned = { currency: string; ownerMemberId: string | null };
type Column = { memberId: string | null; name: string } & ByClass & {
    liabilities: number;
    netWorth: number;
  };

const emptyClasses = (): ByClass => ({ liquid: 0, property: 0, investment: 0, other: 0 });
const bp = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part * 10_000) / whole);
const asClass = (c: string): AssetClass =>
  (ASSET_CLASSES as readonly string[]).includes(c) ? (c as AssetClass) : 'other';

/**
 * Family wealth in `currency` (the wealth currency): non-archived accounts + assets − liabilities,
 * split by member and asset class. Amounts without an exchange rate are reported, never added 1:1.
 */
export function computeNetWorth(input: {
  currency: string;
  month: string;
  rates: Rate[];
  members: { id: string; name: string }[];
  accounts: (Owned & { name: string; balance: number; assetClass: string; archived: boolean })[];
  assets: (Owned & { name: string; value: number | null; assetClass: string })[];
  liabilities: (Owned & { name: string; outstanding: number | null })[];
}) {
  const unconverted = new Map<string, number>();
  const toWealth = (amount: number, currency: string) => {
    const v = convert(amount, currency, input.currency, input.month, input.rates);
    if (v === null) unconverted.set(currency, (unconverted.get(currency) ?? 0) + amount);
    return v;
  };

  const columns = new Map<string | null, Column>();
  const column = (memberId: string | null) => {
    const known = memberId ? input.members.find((m) => m.id === memberId) : undefined;
    const key = known ? known.id : null; // a deleted owner counts as Shared
    let c = columns.get(key);
    if (!c) {
      c = {
        memberId: key,
        name: known?.name ?? 'Shared',
        ...emptyClasses(),
        liabilities: 0,
        netWorth: 0,
      };
      columns.set(key, c);
    }
    return c;
  };

  const byClass = emptyClasses();
  const addHolding = (item: Owned & { assetClass: string }, amount: number) => {
    const v = toWealth(amount, item.currency);
    if (v === null) return;
    const cls = asClass(item.assetClass);
    const c = column(item.ownerMemberId);
    c[cls] += v;
    c.netWorth += v;
    byClass[cls] += v;
  };
  for (const a of input.accounts) if (!a.archived) addHolding(a, a.balance);
  for (const a of input.assets) if (a.value !== null) addHolding(a, a.value);

  let liabilities = 0;
  for (const l of input.liabilities) {
    if (l.outstanding === null) continue;
    const v = toWealth(l.outstanding, l.currency);
    if (v === null) continue;
    const c = column(l.ownerMemberId);
    c.liabilities += v;
    c.netWorth -= v;
    liabilities += v;
  }

  const assets = byClass.liquid + byClass.property + byClass.investment + byClass.other;
  const order = (c: Column) =>
    c.memberId === null ? Infinity : input.members.findIndex((m) => m.id === c.memberId);
  return {
    currency: input.currency,
    assets,
    liabilities,
    netWorth: assets - liabilities,
    debtRatioBp: bp(liabilities, assets),
    byClass,
    columns: [...columns.values()].sort((a, b) => order(a) - order(b)),
    unconverted: [...unconverted].map(([currency, amount]) => ({ currency, amount })),
  };
}
export type NetWorth = ReturnType<typeof computeNetWorth>;
