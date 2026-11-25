import { useId } from 'react';

/**
 * Shares of a whole as a slim ring of rounded pieces with gaps between them and a soft glow.
 * Decorative: the legend beside it says the figures in words.
 */
export function Ring({
  slices,
  size = 80,
  thickness = 8,
}: {
  slices: { key: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
}) {
  const glow = `ring${useId().replace(/:/g, '')}`;
  const r = 50 - thickness / 2 - 2;
  const c = 2 * Math.PI * r;
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((t, s) => t + s.value, 0);
  // the round caps reach past each end by half the thickness: leave room for them and a gap
  const gap = shown.length > 1 ? thickness + 4 : 0;
  let at = 0;
  const arcs = shown.map((s) => {
    const len = (s.value / total) * c;
    // too thin for an arc beside its gaps: a dot in the middle of its share
    const arc =
      len - gap < 0.5
        ? { ...s, dash: 0.1, offset: -(at + len / 2) }
        : { ...s, dash: len - gap, offset: -(at + gap / 2) };
    at += len;
    return arc;
  });
  const circles = arcs.map((a) => (
    <circle
      key={a.key}
      cx="50"
      cy="50"
      r={r}
      fill="none"
      stroke={a.color}
      strokeWidth={thickness}
      strokeLinecap="round"
      strokeDasharray={`${a.dash} ${c}`}
      strokeDashoffset={a.offset}
    />
  ));
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="shrink-0 -rotate-90"
      aria-hidden
    >
      <defs>
        <filter id={glow} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
      </defs>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--c-grid)" strokeWidth={thickness} />
      <g filter={`url(#${glow})`} opacity={0.55}>
        {circles}
      </g>
      {circles}
    </svg>
  );
}

/**
 * A share (0…1) as a three-quarter gauge: a slim track and a teal-to-green arc ending in a
 * glowing white tip. `children` goes in the middle. Decorative: say the figure in words too.
 */
export function Gauge({
  fraction,
  size = 72,
  children,
}: {
  fraction: number;
  size?: number;
  children?: React.ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  const r = 44;
  const c = 2 * Math.PI * r;
  const sweep = c * 0.75;
  const f = Math.min(1, Math.max(0, fraction));
  const len = sweep * f;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="rotate-[135deg]" aria-hidden>
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2dd4bf" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <filter id={`f${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--c-grid)"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${sweep} ${c}`}
        />
        {f > 0 && (
          <>
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={`url(#g${id})`}
              strokeWidth={9}
              strokeLinecap="round"
              strokeDasharray={`${len} ${c}`}
            />
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="#10b981"
              strokeWidth={9}
              strokeLinecap="round"
              strokeDasharray={`0.1 ${c}`}
              strokeDashoffset={-len + 0.1}
              filter={`url(#f${id})`}
            />
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="#fff"
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={`0.1 ${c}`}
              strokeDashoffset={-len + 0.1}
            />
          </>
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </span>
  );
}
