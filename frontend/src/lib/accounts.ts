/**
 * Accounts offered in pickers: active ones, plus any archived account the edited transaction
 * already uses (as source or transfer destination) so editing it keeps working.
 */
export function selectableAccounts<T extends { id: string; archived: boolean }>(
  accounts: T[],
  txn?: { accountId: string; transferAccountId: string | null },
): T[] {
  return accounts.filter(
    (a) => !a.archived || a.id === txn?.accountId || a.id === txn?.transferAccountId,
  );
}
