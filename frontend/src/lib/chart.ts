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

/**
 * Where to put end-of-line labels so none overlap: each moves as little as possible, they keep
 * their order and stay at least `gap` apart, inside [min, max] (pixels, top down).
 */
export function spreadLabels(ys: number[], gap: number, min = -Infinity, max = Infinity) {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  // Labels that would touch form a cluster, centred on its members' mean; clusters that then
  // touch merge, until none do.
  let clusters = order.map((o) => ({ members: [o], top: o.y }));
  const place = (c: { members: { y: number }[] }) => {
    const mean = c.members.reduce((s, m) => s + m.y, 0) / c.members.length;
    const height = (c.members.length - 1) * gap;
    return Math.min(Math.max(mean - height / 2, min), max - height);
  };
  for (let merged = true; merged;) {
    merged = false;
    for (let k = 0; k + 1 < clusters.length; k++) {
      const a = clusters[k]!;
      const b = clusters[k + 1]!;
      if (a.top + (a.members.length - 1) * gap + gap > b.top) {
        const joined = { members: [...a.members, ...b.members], top: 0 };
        joined.top = place(joined);
        clusters.splice(k, 2, joined);
        merged = true;
        break;
      }
    }
    clusters = clusters.map((c) => ({ ...c, top: place(c) }));
  }
  const out = new Array<number>(ys.length);
  for (const c of clusters) c.members.forEach((m, j) => (out[m.i] = c.top + j * gap));
  return out;
}
