export type BalanceTxn = {
  accountId: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  transferAccountId: string | null;
  transferAmount: number | null;
};

/** Balance per account (in its own currency) = opening ± transactions on either side. */
export function computeBalances(
  accounts: { id: string; openingBalance: number }[],
  txns: BalanceTxn[],
): Map<string, number> {
  const balances = new Map(accounts.map((a) => [a.id, a.openingBalance]));
  const add = (id: string, delta: number) => {
    const current = balances.get(id);
    if (current !== undefined) balances.set(id, current + delta);
  };
  for (const t of txns) {
    if (t.type === 'income') add(t.accountId, t.amount);
    else if (t.type === 'expense') add(t.accountId, -t.amount);
    else {
      add(t.accountId, -t.amount);
      if (t.transferAccountId) add(t.transferAccountId, t.transferAmount ?? t.amount);
    }
  }
  return balances;
}
