import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type AiStatus = {
  /** the server has a key */
  available: boolean;
  /** …and this family switched AI on */
  enabled: boolean;
  model: string | null;
  usedTokens: number;
  monthlyTokens: number | null;
};
export type AiCategorySuggestions = {
  suggestions: { index: number; categoryId: string }[];
  /** different texts asked about, and those left out (over the limit per request) */
  asked: number;
  left: number;
  /** a later batch failed: what was found is kept */
  error: string | null;
};

export const useAiStatus = () =>
  useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<AiStatus>('/ai/status') });
