import type { Bucket } from './types';

export type Shares = { essentials: number | null; fun: number | null; future: number | null };
export type Totals = {
  netIncome: number;
  essentials: number;
  fun: number;
  future: number;
  uncategorised: number;
  spent: number;
  unused: number;
  savingsRateBp: number | null;
  sharesBp: Shares;
};
export type Dashboard = {
  from: string;
  to: string;
  currency: string;
  months: (Totals & { month: string })[];
  totals: Totals;
  previous: Totals | null;
  categories: { categoryId: string | null; name: string; bucket: Bucket | null; actual: number }[];
  members: { memberId: string | null; name: string; actual: number }[];
  unconverted: { currency: string; amount: number }[];
  targets: { essentials: number; fun: number; future: number };
  firstMonth: string | null;
  accounts: { currency: string; balance: number }[];
};
