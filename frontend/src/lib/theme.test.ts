import { describe, expect, it } from 'vitest';
import { applyLook, modeFor, readLook, saveLook } from './theme';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};
const fakeRoot = () => ({
  dataset: {} as Record<string, string>,
  style: {} as Record<string, string>,
});

describe('theme', () => {
  it('defaults to the modern look and remembers the choice', () => {
    const s = memory();
    expect(readLook(s)).toBe('modern');
    saveLook('retro', s);
    expect(readLook(s)).toBe('retro');
  });

  it('survives storage that throws (private mode)', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readLook(broken)).toBe('modern');
    expect(() => saveLook('retro', broken)).not.toThrow();
  });

  it('modern follows the system dark mode; retro is always its own light arcade palette', () => {
    expect(modeFor('modern', true)).toBe('dark');
    expect(modeFor('modern', false)).toBe('light');
    expect(modeFor('retro', true)).toBe('light');
  });

  it('applies the look and mode to the page', () => {
    const root = fakeRoot();
    applyLook('retro', true, root);
    expect(root.dataset).toEqual({ style: 'retro', mode: 'light' });
    expect(root.style.colorScheme).toBe('light');
    applyLook('modern', true, root);
    expect(root.dataset).toEqual({ style: 'modern', mode: 'dark' });
    expect(root.style.colorScheme).toBe('dark');
  });
});
