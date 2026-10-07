import { describe, expect, it } from 'vitest';
import { selectableAccounts } from './accounts';

const acc = (id: string, archived = false) => ({ id, archived });

describe('selectableAccounts', () => {
  const all = [acc('a'), acc('old-src', true), acc('old-dest', true), acc('b')];

  it('hides archived accounts for new transactions', () => {
    expect(selectableAccounts(all).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it("keeps an edited transaction's archived source and transfer destination", () => {
    const ids = selectableAccounts(all, {
      accountId: 'old-src',
      transferAccountId: 'old-dest',
    }).map((a) => a.id);
    expect(ids).toEqual(['a', 'old-src', 'old-dest', 'b']);
  });
});
