import { Bar, BarChart, Cell, ResponsiveContainer, YAxis } from 'recharts';

/**
 * Amounts as thin spikes, one per period, the latest one bright and the earlier ones faded —
 * for money that comes in lumps (income). Decorative: the card says the figures in words.
 */
export function Spikes({
  values,
  height = 40,
  color = '#10b981',
}: {
  values: number[];
  height?: number;
  color?: string;
}) {
  // from the first amount on; nothing to draw for one bar or none
  const first = values.findIndex((v) => v !== 0);
  const shown = first === -1 ? [] : values.slice(first);
  if (shown.length < 2) return null;
  const data = shown.map((v, i) => ({ i, v: Math.max(0, v) }));
  return (
    <div aria-hidden className="w-full min-w-0 overflow-hidden" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          barCategoryGap="30%"
        >
          <YAxis hide domain={[0, 'dataMax']} />
          <Bar dataKey="v" maxBarSize={4} radius={2} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.i} fill={color} fillOpacity={d.i === data.length - 1 ? 1 : 0.45} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
