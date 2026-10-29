import { expect, test } from '@playwright/test';

const today = new Date().toISOString().slice(0, 10);

test('Analytics → Currencies: euro, dollar and rupee rates, their moves, and transfers against the market', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`fx-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  // 1,000 € sent home: ₹99,800 arrived (the stand-in ECB says ₹100.80 per euro)
  const acc = async (data: object) =>
    (await (await page.request.post('/api/accounts', { data })).json()).data;
  const eur = await acc({ name: 'Sparkasse', type: 'current', currency: 'EUR' });
  const inr = await acc({ name: 'ICICI', type: 'savings', currency: 'INR' });
  const sent = await page.request.post('/api/transactions', {
    data: {
      date: today,
      type: 'transfer',
      amount: 100_000,
      transferAmount: 9_980_000,
      accountId: eur.id,
      transferAccountId: inr.id,
    },
  });
  expect(sent.status()).toBe(201);

  await page.getByRole('link', { name: 'Analytics' }).first().click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByRole('heading', { name: 'Currencies' })).toBeVisible();
  // the three pairs: 100.80 ₹ per €, 1.12 $ per €, so 90.00 ₹ per $
  await expect(page.getByText('₹100.80').first()).toBeVisible();
  await expect(page.getByText('$1.1200').first()).toBeVisible();
  await expect(page.getByText('₹90.00').first()).toBeVisible();
  await expect(page.getByText('in a year').first()).toBeVisible();

  // the three moves on one scale, then one pair's rate; a table for each
  const chart = page.locator('section', {
    has: page.getByRole('heading', { name: /How the three moved/ }),
  });
  await expect(chart.locator('.recharts-line')).toHaveCount(3);
  await chart.screenshot({ path: 'e2e/screenshots/currencies-chart.png' });
  await page.getByRole('radiogroup', { name: 'Range' }).getByRole('radio', { name: '1M' }).click();
  await page
    .getByRole('radiogroup', { name: 'Show' })
    .getByRole('radio', { name: '€ → ₹' })
    .click();
  const rate = page.locator('section', {
    has: page.getByRole('heading', { name: /Euro in rupees/ }),
  });
  await expect(rate.locator('.recharts-line')).toHaveCount(1);
  await rate.screenshot({ path: 'e2e/screenshots/currencies-rate.png' });
  await rate.getByRole('button', { name: 'Show table' }).click();
  await expect(rate.getByRole('table')).toContainText('₹100.80');

  // the transfer against the market: ₹1,000 less than at the ECB rate (−0.99 %)
  const transfers = page.locator('section', {
    has: page.getByRole('heading', { name: 'Your transfers against the market' }),
  });
  await expect(transfers).toContainText('Sparkasse → ICICI');
  await expect(transfers).toContainText('₹99.80');
  await expect(transfers).toContainText('−₹1,000.00');
  await expect(transfers).toContainText('₹1,000.00 less');
  await page.screenshot({ path: 'e2e/screenshots/currencies.png', fullPage: true });
});
