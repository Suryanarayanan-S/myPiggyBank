import { useId } from 'react';

/**
 * The latest point of a line, lit up: a soft halo, a bright dot ringed in the line's colour and
 * a beam of light fading down to the floor of the chart. `small` is for the little graphs.
 */
export function GlowEnd({
  cx,
  cy,
  color,
  floor,
  small = false,
}: {
  cx: number;
  cy: number;
  color: string;
  /** the y of the chart's floor, in pixels */
  floor: number;
  small?: boolean;
}) {
  const id = `glow${useId().replace(/:/g, '')}`;
  const beam = small ? 4 : 8;
  return (
    <g aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.45} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {floor > cy && (
        <rect x={cx - beam / 2} y={cy} width={beam} height={floor - cy} fill={`url(#${id})`} />
      )}
      <circle cx={cx} cy={cy} r={small ? 6 : 10} fill={color} fillOpacity={0.22} />
      <circle
        cx={cx}
        cy={cy}
        r={small ? 3 : 4.5}
        fill="#fff"
        stroke={color}
        strokeWidth={small ? 1.5 : 2}
      />
    </g>
  );
}
