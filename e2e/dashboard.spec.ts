import { expect, test, type Page } from '@playwright/test';
import { buildWorkbook } from '../backend/test/fixtures/workbook';

const shot = async (page: Page, name: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300); // let colour transitions finish before capturing
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

/** Sheet name like "Aug 26" for `back` months before the current local month. */
const sheetName = (back: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - back);
  return `${d.toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3)} ${String(d.getFullYear()).slice(2)}`;
};

test('dashboard shows period totals, insights, charts with table views', async ({ page }) => {
  const month = (back: number, salary: number, rent: number, fun: number, future: number) => ({
    name: sheetName(back),
    income: [['Salary', salary]] as [string, number][],
    essentials: [['Rent', rent]] as [string, number][],
    fun: [['Restaurant', fun]] as [string, number][],
    future: [['Stocks', future]] as [string, number][],
  });
  const workbook = await buildWorkbook([
    month(5, 3000, 900, 300, 300), // previous period
    month(2, 3750, 912, 172, 580),
    month(1, 3750, 912, 400, 100),
    month(0, 3750, 912, 2000, 0), // a zero amount is skipped by the importer
  ]);

  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`dash-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  await page.getByRole('link', { name: 'Transactions' }).first().click();

  await page.getByRole('link', { name: 'Import' }).first().click();
  await page
    .locator('#import-file')
    .setInputFiles({ name: 'm.xlsx', mimeType: 'application/octet-stream', buffer: workbook });
  await page.getByRole('button', { name: 'Import 4 months' }).click();
  await expect(page.getByText(/Imported 15 transactions/)).toBeVisible();

  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await page.getByRole('radio', { name: 'Last 3 months' }).click();
  const tile = (label: string) =>
    page.locator('section', { has: page.getByText(label, { exact: true }) }).first();
  await expect(tile('Net income')).toContainText('11.250,00 €');
  await expect(tile('Spent')).toContainText('5.308,00 €'); // 3×912 + 172 + 400 + 2000
  await expect(tile('Make Me Rich')).toContainText('680,00 €');
  await expect(page.getByText('Financial insights')).toBeVisible();
  await expect(
    page
      .getByText(
        /Make Me Happy took .* above its 30 % target|Make Me Rich got .* below its 20 % target/,
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByText('Income and where it went')).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();

  const cashFlow = page.locator('section', { has: page.getByText('Income and where it went') });
  await cashFlow.getByRole('button', { name: 'Show table' }).click();
  await expect(cashFlow.getByRole('table')).toContainText('3.750,00 €');
  await cashFlow.getByRole('button', { name: 'Show chart' }).click();
  await shot(page, '12-dashboard');

  await page.getByRole('radio', { name: 'All time' }).click();
  await expect(tile('Net income')).toContainText('14.250,00 €');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '13-mobile-dashboard');
});
