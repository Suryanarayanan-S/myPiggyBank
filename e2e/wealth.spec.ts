import { expect, test, type Page } from '@playwright/test';
import { openSection } from './sections';

const shot = async (page: Page, name: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300); // let colour transitions finish before capturing
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

test('family wealth: members, assets in lakh, EUR account converted, loan, past entries', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`wealth-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  // Members, an EUR account and this month's EUR→INR rate.
  await openSection(page, 'Settings');
  for (const name of ['Appa', 'Adhira', 'Dayana']) {
    await page.getByLabel('New member name').fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await page.getByLabel('equals').fill('100');
  await page.getByRole('button', { name: 'Save rate' }).click();
  await openSection(page, 'Transactions');
  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await page.getByRole('button', { name: 'Add account' }).click();
  const acc = page.getByRole('dialog');
  await acc.getByLabel('Name').fill('Sparkasse');
  await acc.getByLabel('Opening balance').fill('25.000,00'); // €25,000 → ₹25 L
  await acc.getByLabel('Owner').selectOption({ label: 'Surya' });
  await acc.getByRole('button', { name: 'Save' }).click();
  await expect(acc).toBeHidden();

  await openSection(page, 'Wealth');
  const addAsset = async (name: string, cls: string, owner: string, value: string) => {
    await page.getByRole('button', { name: 'Add asset' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Name').fill(name);
    await d.getByLabel('Type').selectOption({ label: cls });
    await d.getByLabel('Belongs to').selectOption({ label: owner });
    await d.getByLabel('Current value').fill(value);
    await d.getByRole('button', { name: 'Save' }).click();
    await expect(d).toBeHidden();
  };
  await addAsset('Jothi ilam', 'Property', 'Appa', '80 L');
  await addAsset('Aniyapuram land', 'Property', 'Surya', '20 L');
  await addAsset('Paytm stocks', 'Investments', 'Appa', '4.5 L');
  await addAsset('TMB FD', 'Liquid funds', 'Adhira', '5 L');
  await addAsset('Kotak FD', 'Liquid funds', 'Dayana', '7.5 L');

  await page.getByRole('button', { name: 'Add loan' }).click();
  const loan = page.getByRole('dialog');
  await loan.getByLabel('Name').fill('Car loan');
  await loan.getByLabel('Belongs to').selectOption({ label: 'Surya' });
  await loan.getByLabel('Outstanding today').fill('2 L');
  await loan.getByLabel('Interest % per year').fill('8.5');
  await loan.getByRole('button', { name: 'Save' }).click();
  await expect(loan).toBeHidden();

  // 80 + 20 + 4.5 + 5 + 7.5 + 25 (EUR account) − 2 = ₹1.4 Cr
  await expect(page.getByText('₹1,40,00,000.00', { exact: true }).first()).toBeVisible();
  // the family tree: each person around the family, in the order they were added
  const tree = page.getByRole('region', { name: 'Family members' });
  const people = tree.getByRole('button');
  await expect(people).toHaveCount(4);
  await expect(people.nth(0)).toContainText('Surya');
  await expect(people.nth(1)).toContainText('Appa');
  await expect(people.nth(1)).toContainText('₹84.5 L');
  await expect(page.getByRole('list', { name: 'Assets by kind' })).toContainText('Property');
  // choosing a person shows only their assets and loans; choosing again shows everyone's
  await people.nth(1).click();
  await expect(people.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Jothi ilam')).toBeVisible();
  await expect(page.getByText('Kotak FD')).toBeHidden();
  await expect(page.getByText('No loans for Appa.')).toBeVisible();
  await expect(tree.getByRole('list', { name: 'Appa: made of' })).toContainText('Property');
  await people.nth(1).click();
  await expect(page.getByText('Kotak FD')).toBeVisible();

  // the earlier history is folded away until opened
  await page.locator('summary', { hasText: 'Earlier history' }).click();
  await page.getByRole('button', { name: 'Add past entry' }).click();
  const past = page.getByRole('dialog');
  await past.getByLabel('Date').fill('2024-01-26');
  await past.getByLabel('Net worth (INR)').fill('1.35 Cr');
  await expect(past.getByText('= ₹1,35,00,000.00')).toBeVisible(); // what was understood is always shown
  await past.getByLabel('Note').fill('Initial');
  await past.getByRole('button', { name: 'Save' }).click();
  await expect(past).toBeHidden();
  // today's net worth is worked out: nothing to save
  await expect(page.getByRole('button', { name: /snapshot/ })).toHaveCount(0);
  await expect(page.getByLabel('Note for 2024-01-26')).toHaveValue('Initial');
  await expect(page.getByText('₹1.35 Cr')).toBeVisible(); // the past entry keeps its two decimals
  await shot(page, '14-wealth');

  // the dashboard shows the same net worth and the change, with what it is made of; the
  // whole card opens Family wealth
  await openSection(page, 'Dashboard');
  const worth = page.getByRole('link', { name: /Net worth.*open Family wealth/ });
  // the last year, the past entry from before it starting the line
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  if (yearAgo.getDate() !== new Date().getDate()) yearAgo.setDate(0); // 29 Feb → 28 Feb
  const label = (o: Intl.DateTimeFormatOptions) => yearAgo.toLocaleDateString('en-GB', o);
  await expect(worth).toContainText(`since ${label({ month: 'short', year: 'numeric' })}`);
  await expect(worth).toContainText(
    `Since ${label({ day: 'numeric', month: 'short', year: 'numeric' })}`,
  );
  await expect(worth.getByRole('list', { name: 'Made of' })).toContainText('Property');
  await worth.screenshot({ path: 'e2e/screenshots/dashboard-net-worth.png' });
  await worth.click();
  await expect(page).toHaveURL(/\/wealth$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '15-mobile-wealth');
});

test('mobile bottom bar has four main items and a More menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Mobile');
  await page.getByLabel('Email').fill(`mobile-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  const bar = page.getByRole('navigation', { name: 'Main' });
  await expect(bar.getByRole('link')).toHaveText([
    'Dashboard',
    'Spending',
    'Transactions',
    'Reports',
  ]);
  for (const link of await bar.getByRole('link').all()) {
    const fits = await link.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits, 'bottom bar labels must not overflow').toBe(true);
  }
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // the workspace switch is in the header: The Treasure has its own bar
  await page
    .getByRole('navigation', { name: 'Workspaces' })
    .getByRole('link', { name: /^The Treasure/ })
    .click();
  await expect(bar.getByRole('link')).toHaveText(['Investments', 'Wealth', 'Analytics']);
  await shot(page, '16-mobile-treasure');
});
