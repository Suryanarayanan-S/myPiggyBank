import { expect, test } from '@playwright/test';
import { openSection } from './sections';

test('two workspaces, their sections, related pages as tabs, and old links still work', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`nav-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  // Two workspaces, each with its own menu: The Pocket (everyday) and The Treasure.
  const sections = page.getByRole('navigation', { name: 'Sections' }).getByRole('link');
  const workspaces = page.getByRole('navigation', { name: 'Workspaces' });
  await expect(workspaces.getByRole('link', { name: /^The Pocket/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(sections).toHaveText([
    'Dashboard',
    'Spending',
    'Transactions',
    'Reports',
    'Settings',
  ]);
  await page.goto('/spending/budget?month=2026-05');
  await workspaces.getByRole('link', { name: /^The Treasure/ }).click();
  await expect(page).toHaveURL(/\/investments$/);
  await expect(sections).toHaveText(['Investments', 'Wealth', 'Analytics', 'Settings']);
  await page.goto('/wealth/goals');
  // back where it was left in each
  await workspaces.getByRole('link', { name: /^The Pocket/ }).click();
  await expect(page).toHaveURL(/\/spending\/budget\?month=2026-05$/);
  await workspaces.getByRole('link', { name: /^The Treasure/ }).click();
  await expect(page).toHaveURL(/\/wealth\/goals$/);
  // Settings is in both, and stays in the workspace it was opened from
  await openSection(page, 'Settings');
  await expect(sections).toHaveText(['Investments', 'Wealth', 'Analytics', 'Settings']);

  // Spending: Overview · Budget; the month goes along
  await openSection(page, 'Spending');
  await expect(page).toHaveURL(/\/spending$/);
  const tabs = page.getByRole('navigation', { name: 'Spending pages' });
  await expect(tabs.getByRole('link')).toHaveText(['Overview', 'Budget']);
  await page.goto('/spending/budget?month=2026-05');
  await tabs.getByRole('link', { name: 'Overview' }).click();
  await expect(page).toHaveURL(/\/spending\?month=2026-05$/);

  // Transactions: Transactions · Accounts · Recurring · Import; the month goes along too
  await openSection(page, 'Transactions');
  await expect(page).toHaveURL(/\/transactions$/);
  const txTabs = page.getByRole('navigation', { name: 'Transactions pages' });
  await expect(txTabs.getByRole('link')).toHaveText([
    'Transactions',
    'Accounts',
    'Recurring',
    'Import',
  ]);
  await page.goto('/transactions?month=2026-05');
  await txTabs.getByRole('link', { name: 'Recurring' }).click();
  await expect(txTabs.getByRole('link', { name: 'Recurring' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await txTabs.getByRole('link', { name: 'Transactions' }).click();
  await expect(page).toHaveURL(/\/transactions\?month=2026-05$/);
  // the section stays highlighted in the sidebar
  await txTabs.getByRole('link', { name: 'Accounts' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Transactions' }),
  ).toHaveAttribute('aria-current', 'page');
  // a page of The Treasure switches the workspace with it
  await page.goto('/analytics');
  await expect(workspaces.getByRole('link', { name: /^The Treasure/ })).toHaveAttribute(
    'aria-current',
    'true',
  );

  // Wealth: Net worth & assets · Goals; Reports: Year report · Insights
  await openSection(page, 'Wealth');
  await expect(page.getByRole('navigation', { name: 'Wealth pages' }).getByRole('link')).toHaveText(
    ['Net worth & assets', 'Goals'],
  );
  await openSection(page, 'Reports');
  await expect(
    page.getByRole('navigation', { name: 'Reports pages' }).getByRole('link'),
  ).toHaveText(['Year report', 'Insights']);

  // Bookmarks to the old pages land on the right tab (with their filters).
  for (const [from, to] of [
    ['/accounts', '/transactions/accounts'],
    ['/wealth/accounts', '/transactions/accounts'],
    ['/recurring', '/transactions/recurring'],
    ['/import', '/transactions/import'],
    ['/spending/transactions?categoryId=none', '/transactions?categoryId=none'],
    ['/spending/recurring', '/transactions/recurring'],
    ['/spending/import', '/transactions/import'],
    ['/goals', '/wealth/goals'],
    ['/budget?month=2026-05', '/spending/budget?month=2026-05'],
    ['/budget/overview', '/spending'],
    ['/budget/entry?month=2026-05', '/spending/entry?month=2026-05'],
    ['/insights?x=1', '/reports/insights?x=1'],
  ]) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to.replace('?', '\\?')}$`));
  }
});
