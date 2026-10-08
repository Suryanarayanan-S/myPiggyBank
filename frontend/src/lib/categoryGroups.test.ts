import { describe, expect, it } from 'vitest';
import { groupCategories } from './categoryGroups';
import type { CategorySummary } from './types';

const cat = (
  name: string,
  bucket: CategorySummary['bucket'],
  actual: number,
  limit: number | null = null,
  kind: CategorySummary['kind'] = 'expense',
): CategorySummary => ({
  categoryId: name === 'Uncategorised' ? null : `id-${name}`,
  name,
  kind,
  bucket,
  actual,
  limit,
  remaining: limit === null ? null : limit - actual,
  usedBp: limit === null ? null : Math.round((actual / limit) * 10_000),
  over: limit !== null && actual > limit,
});

describe('groupCategories', () => {
  const groups = groupCategories([
    cat('Rent', 'essentials', 91_200),
    cat('Phone', 'essentials', 0),
    cat('Groceries', 'essentials', 29_600, 25_000),
    cat('Tax', 'essentials', 0, 10_000),
    cat('Restaurants', 'fun', 17_200),
    cat('Salary', null, 575_000, null, 'income'),
  ]);

  it('returns the three buckets in order, even when one is empty', () => {
    expect(groups.map((g) => g.bucket)).toEqual(['essentials', 'fun', 'future']);
    expect(groups[2]!.shown).toEqual([]);
  });

  it('totals each bucket and leaves income categories out', () => {
    expect(groups.map((g) => g.total)).toEqual([120_800, 17_200, 0]);
  });

  it('lists categories with spending or a limit by amount, largest first', () => {
    expect(groups[0]!.shown.map((c) => c.name)).toEqual(['Rent', 'Groceries', 'Tax']);
  });

  it('folds away categories with no spending and no limit', () => {
    expect(groups[0]!.hidden.map((c) => c.name)).toEqual(['Phone']);
  });

  it('gives each shown category its share of the bucket in basis points', () => {
    expect(groups[0]!.shown.map((c) => c.shareBp)).toEqual([7550, 2450, 0]);
    expect(groups[1]!.shown[0]!.shareBp).toBe(10_000);
  });

  it('keeps uncategorised spending separate', () => {
    const g = groupCategories([cat('Uncategorised', null, 4_000)]);
    expect(g.map((x) => x.total)).toEqual([0, 0, 0]);
  });
});
