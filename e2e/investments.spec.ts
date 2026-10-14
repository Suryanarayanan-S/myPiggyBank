import { expect, test, type Page } from '@playwright/test';

const shot = async (page: Page, name: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

test('a holding with buys, a sell, a dividend and a price shows value, gain and totals', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`invest-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  await page.getByRole('link', { name: 'Investments' }).first().click();
  await expect(page.getByText('No holdings yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add holding' }).click();
  const form = page.getByRole('dialog', { name: 'New holding' });
  await form.getByLabel('Name').fill('MSCI World ETF');
  await form.getByLabel('Ticker or ISIN (optional)').fill('IE00B4L5Y983');
  await form.getByLabel('Belongs to').selectOption({ label: 'Surya' });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();

  await page.getByRole('button', { name: 'Trades' }).click();
  const d = page.getByRole('dialog', { name: /Trades/ });
  const addTrade = async (date: string, type: string, units: string, amount: string, fees = '') => {
    await d.getByLabel('Date').first().fill(date);
    await d.getByLabel('Type').selectOption(type);
    if (units) await d.getByLabel('Units').fill(units);
    await d.getByLabel(/Total (paid|received)/).fill(amount);
    if (fees) await d.getByLabel('Fees').fill(fees);
    await d.getByRole('button', { name: 'Add trade' }).click();
    await expect(d.getByLabel(/Total (paid|received)/)).toHaveValue('');
  };
  await addTrade(daysAgo(90), 'buy', '10', '1.000,00', '5,00');
  await addTrade(daysAgo(60), 'buy', '5,5', '600,00');
  await addTrade(daysAgo(30), 'sell', '3', '360,00');
  await addTrade(daysAgo(10), 'dividend', '', '12,40');

  // Selling more than is held is refused with a clear message.
  await d.getByLabel('Date').first().fill(daysAgo(5));
  await d.getByLabel('Type').selectOption('sell');
  await d.getByLabel('Units').fill('100');
  await d.getByLabel(/Total (paid|received)/).fill('1,00');
  await d.getByRole('button', { name: 'Add trade' }).click();
  await expect(d.getByText(/more units than are held/)).toBeVisible();
  await d.getByLabel('Units').fill('');
  await d.getByLabel(/Total (paid|received)/).fill('');

  await d.getByLabel('Price per unit (EUR)').fill('120,50');
  await d.getByRole('button', { name: 'Save price' }).click();
  await expect(d.getByText('120,5 EUR')).toBeVisible();
  await expect(d.locator('dl')).toContainText('49,35 €'); // sold 3 for 360 − cost 310,65
  await d.getByRole('button', { name: 'Done' }).click();

  const row = page.getByRole('row', { name: /MSCI World ETF/ });
  await expect(row).toContainText('12,5'); // 10 + 5,5 − 3 units
  await expect(row).toContainText('1.506,25 €'); // 12,5 × 120,50
  await expect(row).toContainText('120,5 EUR');

  // Totals follow "Show in"; without an EUR→INR rate the INR default lists them separately.
  await expect(page.getByText(/Not in the totals/)).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Show amounts in' })
    .filter({ visible: true })
    .selectOption('EUR');
  const value = page.locator('section', { has: page.getByText('Value', { exact: true }) }).first();
  await expect(value).toContainText('1.506,25 €');
  await expect(
    page.locator('section', { has: page.getByText('Dividends', { exact: true }) }).first(),
  ).toContainText('12,40 €');
  await shot(page, '26-investments');

  await page.getByRole('button', { name: 'Switch to retro look' }).click();
  await page.getByRole('dialog', { name: 'myPiggyBank start screen' }).press('Enter');
  await page.screenshot({ path: 'e2e/screenshots/27-retro-investments.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Switch to modern look' }).first().click();
  await page.screenshot({ path: 'e2e/screenshots/28-mobile-investments.png', fullPage: true });
});
