import { expect, test } from '@playwright/test';
import { sparkasseCsv } from '../backend/test/fixtures/bankCsv';

test('AI suggests categories for bank lines nothing else can place, and a kept one is remembered', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`ai-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  // off until switched on in Settings
  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: 'Categories for bank lines' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.getByText(/This month: 0 tokens used · 2,000,000 a month on this server/),
  ).toBeVisible();

  await page.goto('/wealth/accounts');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Sparkasse');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // the bakery is the one line no keyword knows: the AI suggests Groceries, marked "AI"
  await page.goto('/transactions/import');
  await page.getByRole('tab', { name: 'Bank statement (CSV)' }).click();
  await page.locator('#bank-file').setInputFiles({
    name: 'umsatz.csv',
    mimeType: 'text/csv',
    buffer: sparkasseCsv(),
  });
  await page.getByRole('button', { name: 'Check rows' }).click();
  await expect(page.getByRole('status')).toContainText(
    'AI suggested a category for 1 of 1 uncategorised lines',
  );
  const row5 = page.getByRole('row').filter({ hasText: 'Bäckerei' });
  await expect(row5.getByText('AI suggestion')).toBeVisible();
  await expect(row5.getByRole('combobox')).toHaveValue(/.+/);
  await expect(page.getByLabel('Category for row 5').locator('option:checked')).toHaveText(
    'Groceries',
  );
  await page.getByRole('button', { name: 'Import 5 transactions' }).click();
  await expect(page.getByText('Imported 5 transactions.')).toBeVisible();

  // next month's bakery: the kept suggestion became a rule, the AI is not asked again
  await page.locator('#bank-file').setInputFiles({
    name: 'umsatz-november.csv',
    mimeType: 'text/csv',
    buffer: sparkasseCsv([
      '"DE00123";"05.11.26";"05.11.26";"KARTENZAHLUNG";"Bäckerei Schäfer";"Bäckerei";"DE55";"BIC";"-6,20";"EUR";"Umsatz gebucht"',
    ]),
  });
  await page.getByRole('button', { name: 'Check rows' }).click();
  await expect(page.getByLabel('Category for row 1').locator('option:checked')).toHaveText(
    'Groceries',
  );
  await expect(page.getByRole('status')).toBeHidden();

  await page.goto('/settings');
  await expect(page.getByText(/This month: 940 tokens used/)).toBeVisible();
});
