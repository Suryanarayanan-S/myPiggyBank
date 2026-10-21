import { describe, expect, it } from 'vitest';
import { readChoice, saveChoice } from './remember';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};
const broken = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

describe('remembered choices', () => {
  it('reads back a saved choice, and only an allowed one', () => {
    const s = memory();
    expect(readChoice('k', ['a', 'b'] as const, 'a', s)).toBe('a');
    saveChoice('k', 'b', s);
    expect(readChoice('k', ['a', 'b'] as const, 'a', s)).toBe('b');
    saveChoice('k', 'zzz', s);
    expect(readChoice('k', ['a', 'b'] as const, 'a', s)).toBe('a');
  });

  it('survives storage that throws (private mode)', () => {
    expect(readChoice('k', ['a', 'b'] as const, 'b', broken)).toBe('b');
    expect(() => saveChoice('k', 'a', broken)).not.toThrow();
  });
});
