import { expect, test } from '@playwright/test';

test('eight sections, related pages as tabs, and old links still work', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`nav-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link')).toHaveText([
    'Dashboard',
    'Spending',
    'Wealth',
    'Investments',
    'Goals',
    'Analytics',
    'Reports',
    'Settings',
  ]);

  // Spending: Overview · Budget · Transactions · Recurring · Import; the month goes along
  await page.getByRole('link', { name: 'Spending' }).first().click();
  await expect(page).toHaveURL(/\/spending$/);
  const tabs = page.getByRole('navigation', { name: 'Spending pages' });
  await expect(tabs.getByRole('link')).toHaveText([
    'Overview',
    'Budget',
    'Transactions',
    'Recurring',
    'Import',
  ]);
  await page.goto('/spending/budget?month=2026-05');
  await tabs.getByRole('link', { name: 'Transactions' }).click();
  await expect(page).toHaveURL(/\/spending\/transactions\?month=2026-05$/);
  await tabs.getByRole('link', { name: 'Budget' }).click();
  await expect(page).toHaveURL(/\/spending\/budget\?month=2026-05$/);
  await tabs.getByRole('link', { name: 'Recurring' }).click();
  await expect(tabs.getByRole('link', { name: 'Recurring' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // the section stays highlighted in the sidebar
  await expect(
    page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Spending' }),
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
    ['/recurring', '/spending/recurring'],
    ['/import', '/spending/import'],
    ['/budget?month=2026-05', '/spending/budget?month=2026-05'],
    ['/budget/overview', '/spending'],
    ['/budget/entry?month=2026-05', '/spending/entry?month=2026-05'],
    ['/transactions?categoryId=none', '/spending/transactions?categoryId=none'],
    ['/transactions/import', '/spending/import'],
    ['/insights?x=1', '/reports/insights?x=1'],
  ]) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to.replace('?', '\\?')}$`));
  }
});
