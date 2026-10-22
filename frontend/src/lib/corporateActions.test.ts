import { describe, expect, it } from 'vitest';
import { actionText, recentActions } from './corporateActions';
import type { Holding, HoldingAction } from './investments';

const action = (p: Partial<HoldingAction>): HoldingAction => ({
  exDate: '2026-10-08',
  purpose: 'FVSPLT FRM RS 10 TO RS 2',
  kind: 'split',
  status: 'applied',
  unitsBefore: '10',
  unitsAfter: '50',
  ...p,
});
const holding = (name: string, actions: HoldingAction[], archived = false) =>
  ({ id: name, name, currency: 'INR', archived, actions }) as unknown as Holding;

describe('corporate actions notice', () => {
  it('lists the last 60 days of open holdings, newest first', () => {
    const list = recentActions(
      [
        holding('A', [action({}), action({ exDate: '2026-07-01' })]),
        holding('B', [action({ exDate: '2026-10-20', kind: 'review', purpose: 'DEMERGER' })]),
        holding('Old', [action({})], true),
        holding('None', []),
      ],
      '2026-10-22',
    );
    expect(list.map((r) => [r.holding.name, r.action.exDate])).toEqual([
      ['B', '2026-10-20'],
      ['A', '2026-10-08'],
    ]);
  });

  it('says what was changed, or what to check', () => {
    const h = holding('BUILDPRO', []);
    expect(actionText(h, action({}))).toEqual({
      text: 'Split on 8 Oct 2026 (FVSPLT FRM RS 10 TO RS 2): units 10 → 50, earlier prices adjusted to match. Money paid is unchanged; a price you type for a day before it should be in the new units.',
      check: false,
    });
    expect(actionText(h, action({ status: 'review', unitsAfter: '10' }))).toMatchObject({
      text: expect.stringMatching(/bought or sold since/),
      check: true,
    });
    expect(
      actionText(h, action({ kind: 'review', status: 'review', purpose: 'DEMERGER' })).text,
    ).toBe(
      'Corporate action on 8 Oct 2026 (DEMERGER): this cannot be worked out automatically — check its units and cost.',
    );
  });
});
