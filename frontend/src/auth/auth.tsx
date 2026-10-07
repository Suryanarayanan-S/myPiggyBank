import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { ApiError, api } from '../lib/api';
import type { Me } from '../lib/types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<Me | null> => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending, error } = useMe();
  if (isPending) return <p className="p-8 text-sm text-slate-500">Loading…</p>;
  if (error) return <p className="p-8 text-sm text-rose-600">Cannot reach the server.</p>;
  if (!data) return <Navigate to="/login" replace />;
  return children;
}
