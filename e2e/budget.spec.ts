import { expect, test, type Page } from '@playwright/test';

const shot = async (page: Page, name: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300); // let colour transitions finish before capturing
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

test('quick entry fills a month and the budget shows 50/30/20, unused and savings rate', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`budget-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Sparkasse');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('link', { name: 'Budget' }).first().click();
  await page.getByRole('link', { name: 'Quick entry' }).click();
  const amounts: Record<string, string> = {
    Salary: '3750',
    'Tax refund': '2000',
    Rent: '912',
    Groceries: '296',
    Restaurants: '172',
    Stocks: '580',
  };
  for (const [category, value] of Object.entries(amounts)) {
    await page.getByLabel(category, { exact: true }).fill(value);
  }
  const box = await page.getByLabel('Rent', { exact: true }).boundingBox();
  expect(box!.width).toBeGreaterThan(100);
  await expect(page.getByText('Unused').locator('..')).toContainText('3.790,00 €');
  await shot(page, '07-quick-entry');
  await page.getByRole('button', { name: 'Save month' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.getByRole('link', { name: 'Back to budget' }).click();
  const card = (label: string) =>
    page.locator('section', { has: page.getByText(label, { exact: true }) }).first();
  await expect(card('Net income')).toContainText('5.750,00 €');
  await expect(card('Unused')).toContainText('3.790,00 €');
  await expect(card('Savings rate')).toContainText('76.0 %');
  await expect(page.getByText('21.0 %')).toBeVisible(); // essentials share
  await expect(page.getByText(/below its 20 % target/)).toBeVisible(); // future you 10.1 %

  const essentials = page.getByRole('region', { name: 'Keep Me Alive' });
  await expect(essentials.getByText('Phone')).toBeHidden(); // nothing spent: folded away
  await essentials.getByRole('button', { name: /more with no spending/ }).click();
  await expect(essentials.getByText('Phone')).toBeVisible();

  await page.getByRole('button', { name: 'Set limit for Groceries' }).click();
  await page.getByLabel('Limit for Groceries').fill('250');
  await page.getByLabel('Limit for Groceries').press('Enter');
  await expect(page.getByText('46,00 € over')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change limit for Groceries' })).toHaveText(
    'Limit 250,00 €',
  );
  await shot(page, '08-budget');

  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '09-mobile-budget');
  await page.setViewportSize({ width: 1280, height: 800 });

  // Next month starts from this one: empty boxes are filled, nothing saved until Save.
  await page.getByRole('link', { name: 'Quick entry' }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByText(/^last month 912,00\s€/)).toBeVisible();
  await page.getByRole('button', { name: 'Like last month' }).click();
  await expect(page.getByLabel('Rent', { exact: true })).toHaveValue('912,00');
  await expect(page.getByLabel('Phone', { exact: true })).toHaveValue('');
  await expect(page.getByText('Unused').locator('..')).toContainText('3.790,00 €');
});
