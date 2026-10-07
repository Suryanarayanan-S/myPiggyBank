/** UTC [start, end) of the calendar month containing `d`. */
export function monthBounds(d: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
}

/** Strict YYYY-MM-DD → UTC midnight Date, or null for impossible dates like 2026-02-30. */
export function parseDay(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().startsWith(s) ? d : null;
}

export const formatDay = (d: Date) => d.toISOString().slice(0, 10);
