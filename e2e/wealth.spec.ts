import { expect, test, type Page } from '@playwright/test';

const shot = async (page: Page, name: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300); // let colour transitions finish before capturing
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

test('family wealth: members, assets in lakh, EUR account converted, loan, snapshots', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`wealth-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  // Members, an EUR account and this month's EUR→INR rate.
  await page.getByRole('link', { name: 'Settings' }).first().click();
  for (const name of ['Appa', 'Adhira', 'Dayana']) {
    await page.getByLabel('New member name').fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await page.getByLabel('equals').fill('100');
  await page.getByRole('button', { name: 'Save rate' }).click();
  await page.getByRole('link', { name: 'Wealth' }).first().click();
  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await page.getByRole('button', { name: 'Add account' }).click();
  const acc = page.getByRole('dialog');
  await acc.getByLabel('Name').fill('Sparkasse');
  await acc.getByLabel('Opening balance').fill('25.000,00'); // €25,000 → ₹25 L
  await acc.getByLabel('Owner').selectOption({ label: 'Surya' });
  await acc.getByRole('button', { name: 'Save' }).click();
  await expect(acc).toBeHidden();

  await page.getByRole('link', { name: 'Wealth' }).first().click();
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
  const table = page.locator('section', { has: page.getByText('By family member') });
  await expect(table.getByRole('columnheader')).toHaveText([
    '',
    'Surya',
    'Appa',
    'Adhira',
    'Dayana',
    'Total',
    'Share',
  ]); // member order = order added
  await expect(table.getByRole('row', { name: /Net worth/ })).toContainText('₹84.5 L'); // Appa

  await page.getByRole('button', { name: 'Add past entry' }).click();
  const past = page.getByRole('dialog');
  await past.getByLabel('Date').fill('2024-01-26');
  await past.getByLabel('Net worth (INR)').fill('1.35 Cr');
  await expect(past.getByText('= ₹1,35,00,000.00')).toBeVisible(); // what was understood is always shown
  await past.getByLabel('Note').fill('Initial');
  await past.getByRole('button', { name: 'Save' }).click();
  await expect(past).toBeHidden();
  await page.getByRole('button', { name: 'Save today’s snapshot' }).click();
  await page.getByRole('dialog').getByLabel('Note').fill('First snapshot in the app');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Note for 2024-01-26')).toHaveValue('Initial');
  await expect(page.getByText('since 26 Jan 2024')).toBeVisible();
  await expect(page.getByText('₹1.35 Cr')).toBeVisible(); // the past entry keeps its two decimals
  await shot(page, '14-wealth');

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
  await expect(bar.getByRole('link')).toHaveText(['Dashboard', 'Budget', 'Transactions', 'Wealth']);
  for (const link of await bar.getByRole('link').all()) {
    const fits = await link.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits, 'bottom bar labels must not overflow').toBe(true);
  }
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
