import { fromFirstValue } from '../../lib/history';
import { GlowEnd } from '../charts/Glow';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts';

/**
 * A small line of how a figure moved, for a card: no axes, a dashed line at where it started and
 * a dot on the latest point. Green when it went the good way, red when not, grey when flat.
 * Decorative: the card says the figures in words.
 */
export function Sparkline({
  values: all,
  upIsGood = true,
  height = 64,
}: {
  values: number[];
  upIsGood?: boolean;
  height?: number;
}) {
  const values = fromFirstValue(all, (v) => v);
  // one point, or nothing recorded at all: no line to draw
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const first = values[0]!;
  const last = values.at(-1)!;
  const color =
    last === first ? 'var(--c-muted)' : last > first === upIsGood ? '#10b981' : '#f43f5e';
  const data = values.map((v, i) => ({ i, v }));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // a flat line sits in the middle rather than on the floor
  const pad = hi === lo ? Math.abs(hi) * 0.1 || 1 : (hi - lo) * 0.08;
  return (
    // min-w-0 and overflow-hidden: the graph never widens what holds it (in a grid that sets a
    // resize loop going — the card and the graph keep resizing each other)
    <div aria-hidden className="w-full min-w-0 overflow-hidden" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 6, left: 2 }}>
          <YAxis hide domain={[lo - pad, hi + pad]} />
          <ReferenceLine
            y={first}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeDasharray="3 3"
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            isAnimationActive={false}
            dot={(p: { cx?: number; cy?: number; index?: number }) =>
              p.index === data.length - 1 && p.cx != null && p.cy != null ? (
                <GlowEnd key="end" cx={p.cx} cy={p.cy} color={color} floor={height - 6} small />
              ) : (
                <g key={`d${p.index}`} />
              )
            }
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
