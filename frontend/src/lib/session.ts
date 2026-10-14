import type { QueryClient } from '@tanstack/react-query';

/** Forget everything cached for the previous user (another family must never see it). */
export function forgetUserData(queryClient: QueryClient) {
  queryClient.removeQueries();
  queryClient.setQueryData(['me'], null);
}
