export const CLASSES = {
  liquid: 'Liquid funds',
  property: 'Property',
  investment: 'Investments',
  other: 'Other',
} as const;
export type AssetClass = keyof typeof CLASSES;
export const CLASS_COLOR: Record<AssetClass, string> = {
  liquid: 'var(--c-liquid)',
  property: 'var(--c-property)',
  investment: 'var(--c-investment)',
  other: 'var(--c-other)',
};
export const LIABILITY_TYPES = {
  mortgage: 'Mortgage',
  car_loan: 'Car loan',
  personal_loan: 'Personal loan',
  credit_card: 'Credit card',
  other: 'Other debt',
} as const;

export type NetWorthColumn = {
  memberId: string | null;
  name: string;
  liabilities: number;
  netWorth: number;
} & Record<AssetClass, number>;
export type NetWorth = {
  currency: string;
  assets: number;
  liabilities: number;
  netWorth: number;
  debtRatioBp: number | null;
  byClass: Record<AssetClass, number>;
  columns: NetWorthColumn[];
  unconverted: { currency: string; amount: number }[];
};
export type Snapshot = {
  id: string;
  date: string;
  currency: string;
  assets: number | null;
  liabilities: number | null;
  netWorth: number;
  note: string | null;
  manual: boolean;
};
export type NetWorthResponse = {
  current: NetWorth;
  snapshots: Snapshot[];
  previousMonth: Snapshot | null;
  previousYear: Snapshot | null;
};
export type Asset = {
  id: string;
  name: string;
  assetClass: AssetClass;
  currency: string;
  ownerMemberId: string | null;
  notes: string | null;
  value: number | null;
  valuedAt: string | null;
  history: { id: string; date: string; value: number; note: string | null }[];
};
export type Liability = {
  id: string;
  name: string;
  type: keyof typeof LIABILITY_TYPES;
  currency: string;
  ownerMemberId: string | null;
  originalAmount: number | null;
  interestRate: string | null;
  monthlyPayment: number | null;
  startDate: string | null;
  endDate: string | null;
  lender: string | null;
  notes: string | null;
  outstanding: number | null;
  balanceAt: string | null;
  history: { id: string; date: string; outstanding: number }[];
};
