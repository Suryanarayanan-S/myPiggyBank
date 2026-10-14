import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { forgetUserData } from './session';

describe('forgetUserData', () => {
  it('drops every cached answer of the previous user and marks them logged out', () => {
    const qc = new QueryClient();
    qc.setQueryData(['budget', '2026-09', 'default'], { netIncome: 1 });
    qc.setQueryData(['accounts'], [{ id: 'a' }]);
    qc.setQueryData(['me'], { user: { id: 'u1' } });
    forgetUserData(qc);
    expect(qc.getQueryData(['budget', '2026-09', 'default'])).toBeUndefined();
    expect(qc.getQueryData(['accounts'])).toBeUndefined();
    expect(qc.getQueryData(['me'])).toBeNull();
  });
});

describe('isSessionExpired', () => {
  it('is only the server saying the login is gone, not a wrong password', async () => {
    const { ApiError } = await import('./api');
    const { isSessionExpired } = await import('./session');
    expect(isSessionExpired(new ApiError(401, 'UNAUTHENTICATED', 'Please log in'))).toBe(true);
    expect(isSessionExpired(new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong password'))).toBe(
      false,
    );
    expect(isSessionExpired(new Error('network'))).toBe(false);
  });
});
