/**
 * Accounts offered in pickers: active ones, plus any archived account the edited transaction
 * already uses (as source or transfer destination) so editing it keeps working.
 */
export function selectableAccounts<T extends { id: string; archived: boolean }>(
  accounts: T[],
  txn?: { accountId: string | null; transferAccountId: string | null },
): T[] {
  return accounts.filter(
    (a) => !a.archived || a.id === txn?.accountId || a.id === txn?.transferAccountId,
  );
}

const LAST_ACCOUNT_KEY = 'pb-last-account';
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const browserStore = (): Store | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

/**
 * The account a new transaction starts with: the last one chosen, where '' means "no account"
 * was chosen; otherwise the first account.
 */
export function defaultAccountId(
  active: { id: string }[],
  store: Store | undefined = browserStore(),
): string {
  let last: string | null = null;
  try {
    last = store?.getItem(LAST_ACCOUNT_KEY) ?? null;
  } catch {
    // Storage may be blocked: start with the first account.
  }
  if (last === '' || active.some((a) => a.id === last)) return last!;
  return active[0]?.id ?? '';
}

export function rememberAccountId(id: string, store: Store | undefined = browserStore()) {
  try {
    store?.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    // Storage may be blocked; the next form simply starts without an account.
  }
}
