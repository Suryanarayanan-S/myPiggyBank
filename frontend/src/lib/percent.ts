/** Basis points (1 bp = 0.01 %) → "21.0 %"; null → "—". */
export const formatPercent = (bp: number | null) =>
  bp === null ? '—' : `${(bp / 100).toFixed(1)} %`;
