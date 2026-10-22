/**
 * Physical gold valued from the IBJA rate for 999 (24K) gold. Other purities follow IBJA's own
 * convention (its 916 rate is the 999 rate × 0.916). Pure; money in minor units.
 */

export const PURITIES = ['24k', '22k', '18k', '14k'] as const;
export type Purity = (typeof PURITIES)[number];
/** Share of the 999 rate a gram of each purity is worth. */
export const PURITY_FACTOR: Record<Purity, number> = {
  '24k': 1,
  '22k': 0.916,
  '18k': 0.75,
  '14k': 0.585,
};

/**
 * Worth of `milligrams` of gold at `rate24k` (micros of rupees per gram of 999 gold), in paise.
 */
export function goldValue(milligrams: number, purity: Purity, rate24k: number): number {
  // grams × rupees per gram × 100, in steps that stay exact for a kilogram and more
  return Math.round((milligrams / 1_000) * (rate24k / 10_000) * PURITY_FACTOR[purity]);
}

/** "12.5" / "12,345" (grams, up to 3 decimals) → milligrams; null unless above zero. */
export function parseGrams(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(s)) return null;
  const mg = Math.round(Number(s) * 1_000);
  return mg > 0 ? mg : null;
}
