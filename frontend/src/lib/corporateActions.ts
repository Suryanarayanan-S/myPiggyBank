import { formatUnits, type Holding, type HoldingAction } from './investments';

/** Shown on the Investments page for this long after the ex-date. */
const SHOW_DAYS = 60;

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const KIND: Record<HoldingAction['kind'], string> = {
  split: 'Split',
  bonus: 'Bonus issue',
  consolidation: 'Consolidation',
  review: 'Corporate action',
};

/** Recent actions of the open holdings, newest first. */
export function recentActions(holdings: Holding[], today: string) {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - SHOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return (
    holdings
      .filter((h) => !h.archived)
      .flatMap((h) => (h.actions ?? []).map((action) => ({ holding: h, action })))
      // found in NSE's history, already in the trades: nothing was changed, nothing to check
      .filter((r) => r.action.status !== 'included')
      .filter((r) => r.action.exDate >= since)
      .sort((a, b) => b.action.exDate.localeCompare(a.action.exDate))
  );
}

/** One line for the notice; `check`: the user needs to look at the holding. */
export function actionText(h: Holding, a: HoldingAction): { text: string; check: boolean } {
  const what = `${KIND[a.kind] ?? KIND.review} on ${dayLabel(a.exDate)} (${a.purpose})`;
  const units = (u: string) => formatUnits(u, h.currency);
  if (a.status === 'applied')
    return {
      text: `${what}: units ${units(a.unitsBefore)} → ${units(a.unitsAfter)}, earlier prices adjusted to match. Money paid is unchanged; a price you type for a day before it should be in the new units.`,
      check: false,
    };
  if (a.kind === 'review')
    return {
      text: `${what}: this cannot be worked out automatically — check its units and cost.`,
      check: true,
    };
  return {
    text: `${what}: it was bought or sold since, so it was not changed automatically — check its units.`,
    check: true,
  };
}

export type EventGroup = 'splits' | 'bonuses' | 'others';
export const EVENT_GROUPS: { key: EventGroup; label: string }[] = [
  { key: 'splits', label: 'Splits' },
  { key: 'bonuses', label: 'Bonuses' },
  { key: 'others', label: 'Mergers & others' },
];

/** Which tab a corporate action is listed under: a consolidation is a split the other way. */
export function eventGroup(kind: HoldingAction['kind']): EventGroup {
  if (kind === 'split' || kind === 'consolidation') return 'splits';
  return kind === 'bonus' ? 'bonuses' : 'others';
}
