import { describe, expect, it } from 'vitest';
import { beforeEach, vi } from 'vitest';
import { forgetPlaces, placeIn, rememberPlace, workspaceOf } from './workspace';

// the tests run in Node: a plain in-memory localStorage
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

describe('workspaces', () => {
  beforeEach(() => forgetPlaces());
  it('knows which workspace a page is in', () => {
    expect(workspaceOf('/', 'treasure')).toBe('pocket');
    expect(workspaceOf('/spending/budget', 'treasure')).toBe('pocket');
    expect(workspaceOf('/transactions/accounts', 'treasure')).toBe('pocket');
    expect(workspaceOf('/reports/insights', 'treasure')).toBe('pocket');
    expect(workspaceOf('/investments/deposits', 'pocket')).toBe('treasure');
    expect(workspaceOf('/wealth/goals', 'pocket')).toBe('treasure');
    expect(workspaceOf('/analytics', 'pocket')).toBe('treasure');
  });

  it('puts an old address where it leads, and never remembers it', () => {
    expect(workspaceOf('/goals', 'pocket')).toBe('treasure');
    expect(workspaceOf('/wealth/accounts', 'treasure')).toBe('pocket');
    rememberPlace('pocket', '/goals');
    expect(placeIn('pocket')).toBe('/');
  });

  it('returns to the last page of each, until logged out', () => {
    rememberPlace('pocket', '/spending/budget?month=2026-05');
    rememberPlace('treasure', '/wealth/goals');
    rememberPlace('treasure', '/settings');
    expect(placeIn('pocket')).toBe('/spending/budget?month=2026-05');
    expect(placeIn('treasure')).toBe('/wealth/goals');
    localStorage.setItem('pb-workspace-treasure', '//elsewhere.example/investments');
    expect(placeIn('treasure')).toBe('/investments');
    forgetPlaces();
    expect(placeIn('pocket')).toBe('/');
  });

  it('keeps the one you were in on a page both share', () => {
    expect(workspaceOf('/settings', 'treasure')).toBe('treasure');
    expect(workspaceOf('/settings', 'pocket')).toBe('pocket');
  });
});
