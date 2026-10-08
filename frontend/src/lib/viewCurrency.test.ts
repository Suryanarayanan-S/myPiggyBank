import { describe, expect, it } from 'vitest';
import { VIEW_KEY, readView, saveView, withView } from './viewCurrency';

const memory = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  };
};

describe('view currency', () => {
  it('is "default" when nothing valid is saved', () => {
    expect(readView(memory())).toBe('default');
    expect(readView(memory({ [VIEW_KEY]: 'XYZ' }))).toBe('default');
    expect(readView(undefined)).toBe('default');
  });

  it('remembers a chosen currency', () => {
    const store = memory();
    saveView('INR', store);
    expect(readView(store)).toBe('INR');
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readView(broken)).toBe('default');
    expect(() => saveView('USD', broken)).not.toThrow();
  });

  it('adds ?currency= only for a chosen currency', () => {
    expect(withView('/budget/2026-09', 'default')).toBe('/budget/2026-09');
    expect(withView('/budget/2026-09', 'INR')).toBe('/budget/2026-09?currency=INR');
    expect(withView('/dashboard?from=2026-01&to=2026-09', 'USD')).toBe(
      '/dashboard?from=2026-01&to=2026-09&currency=USD',
    );
  });
});
