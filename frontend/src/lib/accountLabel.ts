import type { Account, Member } from './types';

/**
 * An account's name as lists show it: with its owner when another account has the same name
 * (each family member may have their own "Zerodha").
 */
export function accountLabeler(
  accounts: Pick<Account, 'id' | 'name' | 'ownerMemberId'>[],
  members: Pick<Member, 'id' | 'name'>[],
) {
  const count = new Map<string, number>();
  for (const a of accounts) {
    const k = a.name.toLowerCase();
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return (a: Pick<Account, 'name' | 'ownerMemberId'>) =>
    (count.get(a.name.toLowerCase()) ?? 0) > 1
      ? `${a.name} · ${a.ownerMemberId ? (members.find((m) => m.id === a.ownerMemberId)?.name ?? '—') : 'Shared'}`
      : a.name;
}
