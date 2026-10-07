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

test('import a workbook: preview, map, import, budget matches, re-import is skipped', async ({
  page,
}) => {
  const workbook = await buildWorkbook([
    {
      name: 'Nov 23',
      layout: 'old',
      income: [['Salary', 3347]],
      essentials: [['Rent', 418]],
      future: [['Stocks', 222]],
    },
    { name: 'Template' },
    {
      name: 'Aug 26',
      income: [['Salary', 3750]],
      essentials: [
        ['Rent', 912],
        ['Phone bill', 20],
      ],
      fun: [
        ['Perima', 10],
        ['Dayana Kodi', 3500],
      ],
      future: [['GRT', 160]],
    },
  ]);
  const file = {
    name: 'Monthly Spending.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook,
  };

  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`import-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  await page.getByRole('link', { name: 'Import' }).first().click();
  await page.locator('#import-file').setInputFiles(file);
  await expect(page.getByText('2 · Categories')).toBeVisible();
  await expect(page.getByText('Skipped sheets: Template')).toBeVisible();
  await expect(page.getByText('Matches the sheet’s own totals')).toHaveCount(2);
  await expect(page.getByLabel('Category for Perima')).toHaveValue('n:Other fun');
  await page.getByLabel('Category for Dayana Kodi').selectOption('n:Dayana Kodi');
  await shot(page, '10-import-preview');

  await page.getByRole('button', { name: 'Import 2 months' }).click();
  await expect(page.getByText(/Imported 9 transactions across 2 months and created/)).toBeVisible();
  await shot(page, '11-import-done');

  await page.getByRole('link', { name: 'Open August 2026' }).click();
  const card = (label: string) =>
    page.locator('section', { has: page.getByText(label, { exact: true }) }).first();
  await expect(card('Net income')).toContainText('3.750,00 €');
  await expect(card('Spent')).toContainText('4.442,00 €');
  await expect(card('Unused')).toContainText('-852,00 €');

  // Re-importing the same file: months default to Skip.
  await page.getByRole('link', { name: 'Import' }).first().click();
  await page.locator('#import-file').setInputFiles(file);
  await expect(page.getByText('Already imported earlier.')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Import 0 months' })).toBeDisabled();
});
