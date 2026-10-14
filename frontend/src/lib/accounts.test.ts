import { describe, expect, it } from 'vitest';
import { defaultAccountId, rememberAccountId, selectableAccounts } from './accounts';

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

describe('defaultAccountId', () => {
  const active = [acc('a'), acc('b')];
  const store = (v: string | null) => ({ getItem: () => v, setItem: () => {} });

  it('starts with the first account the first time', () => {
    expect(defaultAccountId(active, store(null))).toBe('a');
    expect(defaultAccountId([], store(null))).toBe('');
  });

  it('remembers the last choice, including "no account"', () => {
    expect(defaultAccountId(active, store('b'))).toBe('b');
    expect(defaultAccountId(active, store(''))).toBe('');
  });

  it('falls back to the first account when the remembered one is gone or archived', () => {
    expect(defaultAccountId(active, store('old'))).toBe('a');
  });

  it('works when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(defaultAccountId(active, blocked)).toBe('a');
    expect(() => rememberAccountId('a', blocked)).not.toThrow();
  });
});
