import type { Bucket } from './types';

export const BUCKET_COLOR: Record<Bucket, string> = {
  essentials: 'var(--c-essentials)',
  fun: 'var(--c-fun)',
  future: 'var(--c-future)',
};
export const INK = 'var(--c-ink)';
export const SINGLE = 'var(--c-single)';
export const MUTED = 'var(--c-muted)';
export const GRID = 'var(--c-grid)';
export const AXIS = 'var(--c-axis)';
export const SURFACE = 'var(--c-surface)';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09" → "Sep 26" for axis ticks (always three letters). */
export const shortMonth = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

/** Round axis ticks (steps of 1, 2 or 5 × 10ⁿ) that cover [min, max] and include zero. */
export function niceTicks(max: number, min = 0): number[] {
  const lo0 = Math.min(0, min);
  const hi0 = Math.max(0, max);
  if (hi0 === lo0) return [0, 1];
  const rough = (hi0 - lo0) / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((s) => s * mag >= rough) ?? 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(lo0 / step) * step; v <= Math.ceil(hi0 / step) * step; v += step)
    ticks.push(v);
  return ticks;
}

export const axisTick = { fill: 'var(--c-muted)', fontSize: 12 };
