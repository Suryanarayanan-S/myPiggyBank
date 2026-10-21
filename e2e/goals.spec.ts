import { expect, test, type Page } from '@playwright/test';

const shot = async (page: Page, name: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};
const nextYear = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

test('a goal fills from a linked account and entries, and shows on the dashboard', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`goals-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  await page.getByRole('link', { name: 'Wealth' }).first().click();

  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await page.getByRole('button', { name: 'Add account' }).click();
  const acc = page.getByRole('dialog');
  await acc.getByLabel('Name').fill('Tagesgeld');
  await acc.getByLabel('Opening balance').fill('2.000,00');
  await acc.getByRole('button', { name: 'Save' }).click();
  await expect(acc).toBeHidden();

  await page.getByRole('link', { name: 'Goals' }).first().click();
  await expect(page.getByText('No goals yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add goal' }).click();
  const form = page.getByRole('dialog', { name: 'New goal' });
  await form.getByLabel('Name').fill('House deposit');
  await form.getByLabel('Target', { exact: true }).fill('10000');
  await expect(form.getByText('= 10.000,00 €')).toBeVisible();
  await form.getByLabel('Reach it by (optional)').fill(nextYear());
  await form.getByRole('checkbox', { name: 'Tagesgeld' }).check();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();

  const card = page.locator('section', { hasText: 'House deposit' }).last();
  await expect(card).toContainText('2.000,00 €');
  await expect(card).toContainText('of 10.000,00 € · 20 %');
  await expect(card).toContainText('Needed per month');
  await expect(card.getByText('Behind')).toBeVisible(); // nothing saved in the last 3 months

  await card.getByRole('button', { name: /Entries/ }).click();
  const entries = page.getByRole('dialog', { name: /Entries/ });
  await entries.getByLabel('Amount (EUR)').fill('500');
  await entries.getByLabel('Note').fill('Cash at home');
  await entries.getByRole('button', { name: 'Add' }).click();
  await expect(entries.getByText('Cash at home')).toBeVisible();
  await entries.getByRole('button', { name: 'Done' }).click();
  await expect(card).toContainText('2.500,00 €');
  await shot(page, '24-goals');

  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  const summary = page.locator('section', { has: page.getByRole('heading', { name: 'Goals' }) });
  await expect(summary).toContainText('House deposit');
  await expect(summary).toContainText('2.500,00 € of 10.000,00 €');

  await page.getByRole('button', { name: 'Switch to retro look' }).click();
  await page.getByRole('dialog', { name: 'myPiggyBank start screen' }).press('Enter');
  await page.getByRole('link', { name: 'Goals' }).first().click();
  await page.screenshot({ path: 'e2e/screenshots/25-retro-goals.png', fullPage: true });
});
