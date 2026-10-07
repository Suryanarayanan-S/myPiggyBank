import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { sparkasseCsv } from '../backend/test/fixtures/bankCsv';

const shot = async (page: Page, name: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

test('bank CSV import, re-import finds duplicates, recurring rent, CSV export', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`bank-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();
  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Sparkasse');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Bank statement import
  const csv = { name: 'umsatz.csv', mimeType: 'text/csv', buffer: sparkasseCsv() };
  await page.getByRole('link', { name: 'Import' }).first().click();
  await page.getByRole('tab', { name: 'Bank statement (CSV)' }).click();
  await page.locator('#bank-file').setInputFiles(csv);
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('1'); // Buchungstag guessed
  await page.getByRole('button', { name: 'Check rows' }).click();
  await expect(page.getByText('5 readable · 0 already there or possibly entered · 0 unreadable')).toBeVisible();
  await expect(page.getByLabel('Category for row 2')).toHaveValue(/.+/); // REWE → Groceries suggested
  await page.getByLabel('Category for row 5').selectOption({ label: 'Restaurants' });
  await shot(page, '16-bank-review');
  await page.getByRole('button', { name: 'Import 5 transactions' }).click();
  await expect(page.getByText('Imported 5 transactions.')).toBeVisible();

  await page.locator('#bank-file').setInputFiles(csv);
  await page.getByRole('button', { name: 'Check rows' }).click();
  await expect(page.getByText('5 readable · 5 already there or possibly entered · 0 unreadable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 0 transactions' })).toBeDisabled();
  await page.getByLabel('Decimal separator').selectOption(',');
  await page.getByLabel('Date format').selectOption('yyyy-mm-dd');
  await expect(page.getByText('3 · Review')).toBeHidden(); // a changed mapping needs a new check

  // Recurring rent starting today creates today's transaction
  await page.getByRole('link', { name: 'Recurring' }).first().click();
  await page.getByRole('button', { name: 'Add recurring' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill('Rent');
  await d.getByLabel('Amount').fill('912');
  await d.getByLabel('Category').selectOption({ label: 'Rent' });
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d).toBeHidden();
  await expect(
    page.getByText(/Every month · Sparkasse · Rent · next \d{4}-\d{2}-\d{2}/),
  ).toBeVisible();
  await shot(page, '17-recurring');

  // Transactions: bank rows + recurring rent; export
  await page.getByRole('link', { name: 'Transactions' }).first().click();
  await expect(page.getByText('Recurring').first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  const file = await (await download).path();
  const content = fs.readFileSync(file!, 'utf8');
  expect(content).toContain(
    'Date;Type;Amount;Currency;Account;Category;Bucket;Member;Merchant;Notes;Tags',
  );
  expect(content).toContain('REWE · REWE Markt; Filiale 123');
  expect(content).toMatch(/expense;-912,00;EUR;Sparkasse;Rent/);
});
