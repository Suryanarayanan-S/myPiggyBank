import { useQuery } from '@tanstack/react-query';
import type { Goal } from './goals';
import { api } from './api';
import type { Account, Category, Member, Rate } from './types';

export const useAccounts = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/accounts') });
export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });
export const useMembers = () =>
  useQuery({ queryKey: ['members'], queryFn: () => api.get<Member[]>('/members') });
export const useRates = () =>
  useQuery({ queryKey: ['rates'], queryFn: () => api.get<Rate[]>('/exchange-rates') });

export const useGoals = () =>
  useQuery({ queryKey: ['goals'], queryFn: () => api.get<Goal[]>('/goals') });
