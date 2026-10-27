import { expect, test } from '@playwright/test';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

test('a long dividend list scrolls in its box until "Show all"; corporate actions in tabs', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`dividends-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  const id = (
    await (
      await page.request.post('/api/holdings', {
        data: { name: 'ITC', kind: 'stock', symbol: 'ITC', currency: 'INR', ownerMemberId: null },
      })
    ).json()
  ).data.id;
  await page.request.post(`/api/holdings/${id}/trades`, {
    data: { date: daysAgo(340), type: 'buy', units: '100', amount: 4_000_000 },
  });
  for (let i = 0; i < 12; i++) {
    await page.request.post(`/api/holdings/${id}/trades`, {
      data: { date: daysAgo(320 - i * 25), type: 'dividend', amount: 10_000 + i * 100 },
    });
  }
  // splits, a bonus and a demerger as NSE's history would give them (offline here)
  const event = (purpose: string, kind: string, exDate: string, before: number, after: number) => ({
    holdingId: id,
    symbol: 'ITC',
    exDate,
    purpose,
    kind,
    unitsBefore: before,
    unitsAfter: after,
    received: [],
    unlinked: false,
    valueBefore: null,
    valueAfter: null,
    change: null,
  });
  await page.route('**/api/holdings/events', (route) =>
    route.fulfill({
      json: {
        data: [
          event('Bonus 1:1', 'bonus', '2026-06-01', 50, 100),
          event('FVSPLT FRM RS 10 TO RS 1', 'split', '2026-03-01', 5, 50),
          event('Demerger of ITC Hotels', 'review', '2025-01-06', 100, 100),
        ],
      },
    }),
  );

  await page.goto('/investments/market');
  await page.getByRole('tab', { name: 'Dividends' }).click();
  await page.getByLabel('Period').selectOption({ label: 'All years' });
  const box = page.getByRole('region', { name: 'dividends, scrollable' });
  await expect(box).toBeVisible();
  // the box is shorter than the table: it scrolls on its own
  await expect.poll(() => box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.getByRole('button', { name: 'Show all 12 dividends' }).click();
  await expect(box).toBeHidden();
  await expect(page.getByRole('table', { name: /dividends from/ }).getByRole('row')).toHaveCount(
    13,
  );
  await page.getByRole('button', { name: 'Show fewer' }).click();
  await expect(box).toBeVisible();
  // a search that leaves few rows: no box and no button; clearing it starts in the box again
  await page.getByPlaceholder('Search…').fill('nothing like this');
  await expect(page.getByRole('button', { name: /Show all/ })).toBeHidden();
  await page.getByPlaceholder('Search…').fill('');
  await page.getByRole('button', { name: 'Show all 12 dividends' }).click();
  await page.getByLabel('Period').selectOption({ label: 'Last 12 months' });
  await expect(page.getByRole('region', { name: 'dividends, scrollable' })).toBeVisible();

  const history = page.locator('section', {
    has: page.getByRole('heading', { name: 'Splits, bonuses and mergers' }),
  });
  await expect(history.getByRole('tab', { name: 'Splits 1' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(history.getByRole('tabpanel')).toContainText('5 shares → 50 shares');
  await expect(history.getByRole('tabpanel')).not.toContainText('Bonus 1:1');
  await history.getByRole('tab', { name: 'Bonuses 1' }).click();
  await expect(history.getByRole('tabpanel')).toContainText('50 shares → 100 shares');
  await history.getByRole('tab', { name: 'Mergers & others 1' }).click();
  await expect(history.getByRole('tabpanel')).toContainText('Demerger of ITC Hotels');
  await page.screenshot({ path: 'e2e/screenshots/dividends-tab.png', fullPage: true });
});
