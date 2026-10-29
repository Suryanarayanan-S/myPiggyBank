import { expect, test } from '@playwright/test';

test('nine sections, related pages as tabs, and old links still work', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`nav-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link')).toHaveText([
    'Dashboard',
    'Budget',
    'Transactions',
    'Wealth',
    'Investments',
    'Goals',
    'Analytics',
    'Reports',
    'Settings',
  ]);

  // Transactions: All · Recurring · Import
  await page.getByRole('link', { name: 'Transactions' }).first().click();
  const tabs = page.getByRole('navigation', { name: 'Transactions pages' });
  await expect(tabs.getByRole('link')).toHaveText(['All', 'Recurring', 'Import']);
  await tabs.getByRole('link', { name: 'Recurring' }).click();
  await expect(page).toHaveURL(/\/transactions\/recurring$/);
  await expect(tabs.getByRole('link', { name: 'Recurring' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // the section stays highlighted in the sidebar
  await expect(
    page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Transactions' }),
  ).toHaveAttribute('aria-current', 'page');

  // Wealth: Net worth & assets · Accounts; Reports: Year report · Insights
  await page.getByRole('link', { name: 'Wealth' }).first().click();
  await expect(page.getByRole('navigation', { name: 'Wealth pages' }).getByRole('link')).toHaveText(
    ['Net worth & assets', 'Accounts'],
  );
  await page.getByRole('link', { name: 'Reports' }).first().click();
  await expect(
    page.getByRole('navigation', { name: 'Reports pages' }).getByRole('link'),
  ).toHaveText(['Year report', 'Insights']);

  // Bookmarks to the old pages land on the right tab (with their filters).
  for (const [from, to] of [
    ['/accounts', '/wealth/accounts'],
    ['/recurring', '/transactions/recurring'],
    ['/import', '/transactions/import'],
    ['/insights?x=1', '/reports/insights?x=1'],
  ]) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to.replace('?', '\\?')}$`));
  }
});
