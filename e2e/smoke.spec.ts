import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'e2e/screenshots';
const shot = async (page: Page, name: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300); // let colour transitions finish before capturing
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

test('register → account → income → expense → balances → delete account', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'e2e-test-password';

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await shot(page, '01-login');
  await page.getByRole('link', { name: 'Create one' }).click();
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByLabel('Family name (optional)').fill('Soundararajan');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();
  await shot(page, '02-dashboard');

  // Settings: currencies and default bucket categories
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page.getByLabel('Monthly spending in')).toHaveValue('EUR');
  await expect(page.getByLabel('Family wealth in')).toHaveValue('INR');
  await expect(page.getByLabel('Rename Groceries')).toBeVisible();
  const nameBox = await page.getByLabel('Rename Groceries').boundingBox();
  expect(nameBox!.width).toBeGreaterThan(80); // the category name must be readable
  await page.getByLabel('equals').fill('97,85');
  await page.getByRole('button', { name: 'Save rate' }).click();
  await expect(page.getByText('97.85', { exact: true })).toBeVisible();
  await shot(page, '03-settings');

  // Account
  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByLabel('Name').fill('Sparkasse');
  await page.getByLabel('Opening balance').fill('1.000,00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('1.000,00 €').first()).toBeVisible();

  // Income + expense
  await page.getByRole('link', { name: 'Transactions' }).first().click();
  const add = async (
    type: 'Income' | 'Expense',
    amount: string,
    category: string,
    merchant: string,
  ) => {
    await page.getByRole('button', { name: 'Add transaction' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: type.toLowerCase() }).click();
    await dialog.getByLabel(/^Amount/).fill(amount);
    await dialog.getByLabel('Category').selectOption({ label: category });
    await dialog.getByLabel(type === 'Income' ? 'From (payer)' : 'Merchant').fill(merchant);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  };
  await add('Income', '5416', 'Salary', 'Employer GmbH');
  await add('Expense', '52,40', 'Groceries', 'REWE');
  await expect(page.getByText('REWE')).toBeVisible();
  await expect(page.getByText('+5.416,00 €')).toBeVisible();
  await expect(page.getByText('−52,40 €')).toBeVisible();
  for (const label of ['Type', 'Account', 'Category', 'Member']) {
    const select = page.getByRole('combobox', { name: label, exact: true });
    const fits = await select.evaluate(
      (el: HTMLSelectElement) => el.scrollWidth <= el.clientWidth + 1,
    );
    expect(fits, `filter "${label}" text is cut off`).toBe(true);
    expect((await select.boundingBox())!.width).toBeGreaterThan(110);
  }
  await shot(page, '04-transactions');

  // Search
  await page.getByLabel('Search').fill('rewe');
  await page.getByLabel('Search').press('Enter');
  await expect(page.getByText('Employer GmbH')).toBeHidden();
  await expect(page.getByText('REWE')).toBeVisible();

  // Balance: 1000 + 5416 − 52.40
  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await expect(page.getByText('6.363,60 €').first()).toBeVisible();
  await shot(page, '05-accounts');

  // Mobile layout
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Transactions' }).last().click();
  await shot(page, '06-mobile-transactions');
  await page.setViewportSize({ width: 1280, height: 800 });

  // Delete account
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByLabel('Your password').fill(password);
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
});
