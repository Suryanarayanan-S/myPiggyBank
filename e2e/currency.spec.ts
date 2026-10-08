import { expect, test } from '@playwright/test';

test('"Show in" switches every page to one currency and back to each page default', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`currency-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  // A EUR account with a salary this month, and EUR → INR = 100 for this month.
  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Sparkasse');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('link', { name: 'Budget' }).first().click();
  await page.getByRole('link', { name: 'Quick entry' }).click();
  await page.getByLabel('Salary', { exact: true }).fill('1000');
  await page.getByLabel('Groceries', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Save month' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page.getByRole('radio', { name: 'Only my rates' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByLabel('equals').fill('100');
  await page.getByRole('button', { name: 'Save rate' }).click();
  await expect(page.getByText(/1 EUR = 100 INR/)).toBeVisible();

  const showIn = page.getByRole('combobox', { name: 'Show amounts in' }).filter({ visible: true });
  await page.getByRole('link', { name: 'Budget' }).first().click();
  const card = (label: string) =>
    page.locator('section', { has: page.getByText(label, { exact: true }) }).first();
  await expect(card('Net income')).toContainText('1.000,00 €');

  await page.getByRole('button', { name: 'Set limit for Groceries' }).click();
  await page.getByLabel('Limit for Groceries').fill('150');
  await page.getByLabel('Limit for Groceries').press('Enter');
  await expect(page.getByRole('button', { name: 'Change limit for Groceries' })).toBeVisible();

  // No EUR→USD rate: the limit is named, not silently dropped.
  await showIn.selectOption('USD');
  await expect(page.getByText(/No exchange rate to USD for these limits/)).toContainText(
    'Groceries 150,00 €',
  );

  await showIn.selectOption('INR');
  await expect(card('Net income')).toContainText('₹1,00,000.00');
  await expect(page.getByText(/Limits are shown converted to INR/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Set limit for/ })).toHaveCount(0);

  // The choice carries over to other pages and survives a reload.
  await page.reload();
  await expect(showIn).toHaveValue('INR');
  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await expect(page.getByText('All open accounts in INR')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/23-show-in-inr.png', fullPage: true });

  await showIn.selectOption('default');
  await page.getByRole('link', { name: 'Budget' }).first().click();
  await expect(card('Net income')).toContainText('1.000,00 €');
  await expect(page.getByRole('button', { name: 'Change limit for Groceries' })).toBeVisible();
});
