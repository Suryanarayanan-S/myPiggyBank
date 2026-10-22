import { expect, test, type Page } from '@playwright/test';

const shot = async (page: Page, name: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};
const day = (shiftDays: number, shiftYears = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + shiftDays);
  d.setFullYear(d.getFullYear() + shiftYears);
  return d.toISOString().slice(0, 10);
};

test('a fixed deposit linked to an account: valued, shown on the account, paid out', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`deposits-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  await page.getByRole('link', { name: 'Wealth' }).first().click();
  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await page.getByRole('button', { name: 'Add account' }).click();
  const acc = page.getByRole('dialog');
  await acc.getByLabel('Name').fill('Savings');
  await acc.getByRole('button', { name: 'Save' }).click();
  await expect(acc).toBeHidden();

  // Investments has tabs: Overview, Market, Deposits.
  await page.getByRole('link', { name: 'Investments' }).first().click();
  const tabs = page.getByRole('navigation', { name: 'Investments pages' });
  await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText('Nothing invested yet')).toBeVisible();
  await tabs.getByRole('link', { name: 'Deposits' }).click();
  await page.getByRole('button', { name: 'Add fixed deposit' }).click();
  const form = page.getByRole('dialog', { name: 'Add fixed deposit' });
  await form.getByLabel('Name').fill('Bank FD');
  await form.getByLabel(/Bank account/).selectOption({ label: 'Savings (EUR)' });
  await form.getByLabel('Amount deposited').fill('10.000,00');
  await form.getByLabel('Yearly rate (%)').fill('7');
  // started 100 days ago, for a year, compounded quarterly
  await form.getByLabel('Start date').fill(day(-100));
  await form.getByLabel('Maturity date').fill(day(-100, 1));
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();

  const card = page.getByRole('listitem').filter({ hasText: 'Bank FD' });
  await expect(card).toContainText('Running');
  await expect(card).toContainText('10.718,59 €'); // 10.000 × 1.0175⁴ at maturity
  await expect(card).toContainText(/Worth today 10\.\d{3},\d{2}\s€/);
  await shot(page, '37-deposits');

  // On the overview, and on its account.
  await tabs.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByText('Fixed deposits', { exact: true })).toBeVisible();
  // the account is in euros, the totals in rupees (no rate here): named, not dropped
  await expect(page.getByText(/Not in the totals .*10\.\d{3},\d{2}\s€/)).toBeVisible();
  await expect(page.getByText('Nothing invested yet')).toHaveCount(0);
  await page.getByRole('link', { name: 'Wealth' }).first().click();
  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await expect(page.getByText('1 fixed deposit')).toBeVisible();

  // Matured: it is due on the overview, and once paid out it no longer counts.
  await page.getByRole('link', { name: 'Investments' }).first().click();
  await tabs.getByRole('link', { name: 'Deposits' }).click();
  await page.getByRole('button', { name: 'Edit Bank FD' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit fixed deposit' });
  await edit.getByLabel('Start date').fill(day(-400));
  await edit.getByLabel('Maturity date').fill(day(-35));
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(card).toContainText('Matured');
  await tabs.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByRole('heading', { name: 'Maturing soon' })).toBeVisible();
  await tabs.getByRole('link', { name: 'Deposits' }).click();
  await page.getByRole('button', { name: 'Mark Bank FD as paid out' }).click();
  await expect(card).toContainText('Paid out');
  await expect(page.getByRole('heading', { name: 'Paid out' })).toBeVisible();

  // Old addresses of the holdings list still work.
  await page.goto('/investments?tab=holdings');
  await expect(page).toHaveURL(/\/investments\/market\?tab=holdings$/);
});
