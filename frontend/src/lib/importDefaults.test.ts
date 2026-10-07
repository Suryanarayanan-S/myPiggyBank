import { describe, expect, it } from 'vitest';
import { defaultImportMode } from './importDefaults';

describe('defaultImportMode', () => {
  it('imports fresh months', () => {
    expect(defaultImportMode({ imported: 0, manual: 0 })).toBe('import');
  });
  it('skips months imported before', () => {
    expect(defaultImportMode({ imported: 6, manual: 0 })).toBe('skip');
  });
  it('skips months that already have transactions entered in the app, so nothing is counted twice', () => {
    expect(defaultImportMode({ imported: 0, manual: 3 })).toBe('skip');
  });
});
