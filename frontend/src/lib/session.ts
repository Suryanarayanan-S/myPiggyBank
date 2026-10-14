import { ApiError } from './api';
import type { QueryClient } from '@tanstack/react-query';

/** Forget everything cached for the previous user (another family must never see it). */
export function forgetUserData(queryClient: QueryClient) {
  queryClient.removeQueries();
  queryClient.setQueryData(['me'], null);
}

/** The server saying the login is gone — not e.g. a wrong password in "Delete account". */
export const isSessionExpired = (error: unknown) =>
  error instanceof ApiError && error.status === 401 && error.code === 'UNAUTHENTICATED';
