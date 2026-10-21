import { expect, test, type Page } from '@playwright/test';

const shot = async (page: Page, name: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

test('insights name what stands out, on their page and on the dashboard', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`insights-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  await page.getByRole('link', { name: 'Reports' }).first().click();

  await page.getByRole('link', { name: 'Insights' }).first().click();
  await expect(page.getByText('Nothing stands out right now')).toBeVisible();

  await page.getByRole('link', { name: 'Wealth' }).first().click();

  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Sparkasse');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('link', { name: 'Budget' }).first().click();
  await page.getByRole('link', { name: 'Quick entry' }).click();
  await page.getByLabel('Salary', { exact: true }).fill('3000');
  await page.getByLabel('Groceries', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Save month' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('link', { name: 'Back to budget' }).click();
  await page.getByRole('button', { name: 'Set limit for Groceries' }).click();
  await page.getByLabel('Limit for Groceries').fill('250');
  await page.getByLabel('Limit for Groceries').press('Enter');
  await expect(page.getByText('50,00 € over')).toBeVisible();

  const sentence = /Groceries is 50,00\s€ over its limit this month\./;
  await page.getByRole('link', { name: 'Reports' }).first().click();
  await page.getByRole('link', { name: 'Insights' }).first().click();
  await expect(page.getByText(sentence)).toBeVisible();
  await expect(page.getByLabel('Attention')).toBeVisible(); // tone has a name, not only a colour
  await shot(page, '31-insights');

  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Financial insights' }),
  });
  await expect(card.getByText(sentence)).toBeVisible();
  await card.getByRole('link', { name: 'See' }).first().click();
  await expect(page).toHaveURL(/\/budget\?month=/);
});
