import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  COOKIE_SECURE: z.stringbool().default(false),
  ALLOW_REGISTRATION: z.stringbool().default(true),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  /** Login / register / account-deletion attempts per minute and client. */
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  /** Where live exchange rates come from (Frankfurter API, ECB reference rates). */
  RATES_URL: z.url().default('https://api.frankfurter.dev/v1'),
  /** NSE's archive of daily price files (tests point it elsewhere). */
  PRICES_URL: z.url().default('https://nsearchives.nseindia.com/products/content'),
  /** NSE's corporate-action history (past dividends, splits, mergers) */
  NSE_HISTORY_URL: z.url().default('https://www.nseindia.com/api/corporates-corporateActions'),
  /** Indian gold rates page (IBJA) and the world gold price (US dollars per ounce). */
  IBJA_URL: z.url().default('https://ibjarates.com/'),
  GOLD_PRICE_URL: z.url().default('https://api.gold-api.com/price/XAU'),
  GOLD_HISTORY_URL: z.url().default('https://freegoldapi.com/data/latest.json'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
