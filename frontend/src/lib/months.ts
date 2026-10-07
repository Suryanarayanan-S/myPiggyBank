const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM" of `d` in the user's local time zone. */
export const localMonth = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** "YYYY-MM-DD" of `d` in the user's local time zone. */
export const localDay = (d = new Date()) => `${localMonth(d)}-${pad(d.getDate())}`;

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** Last calendar day of the month as "YYYY-MM-DD". */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

export const monthTitle = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const isMonth = (s: string | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
