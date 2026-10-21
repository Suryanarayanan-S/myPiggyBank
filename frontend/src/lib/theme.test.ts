import { describe, expect, it } from 'vitest';
import { applyMode, modeFor, nextModePref, readModePref, saveModePref } from './theme';

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
const broken = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

describe('theme', () => {
  it('defaults to following the system for light or dark, and remembers a choice', () => {
    const s = memory();
    expect(readModePref(s)).toBe('system');
    saveModePref('dark', s);
    expect(readModePref(s)).toBe('dark');
  });

  it('survives storage that throws (private mode)', () => {
    expect(readModePref(broken)).toBe('system');
    expect(() => saveModePref('light', broken)).not.toThrow();
  });

  it('light or dark: the choice wins, "system" follows the computer', () => {
    expect(modeFor('system', true)).toBe('dark');
    expect(modeFor('system', false)).toBe('light');
    expect(modeFor('light', true)).toBe('light');
    expect(modeFor('dark', false)).toBe('dark');
  });

  it('cycles system → light → dark → system', () => {
    expect(nextModePref('system')).toBe('light');
    expect(nextModePref('light')).toBe('dark');
    expect(nextModePref('dark')).toBe('system');
  });

  it('applies the mode to the page', () => {
    const root = fakeRoot();
    applyMode('dark', root);
    expect(root.dataset).toEqual({ mode: 'dark' });
    expect(root.style.colorScheme).toBe('dark');
    applyMode('light', root);
    expect(root.dataset).toEqual({ mode: 'light' });
    expect(root.style.colorScheme).toBe('light');
  });

  it('ignores an unknown saved value', () => {
    const s = memory();
    s.setItem('pb-mode', 'retro');
    expect(readModePref(s)).toBe('system');
  });
});
