import { z } from 'zod';

export const CURRENCIES = ['EUR', 'INR', 'USD', 'GBP'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CurrencySchema = z.enum(CURRENCIES, 'Unsupported currency');
