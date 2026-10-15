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

  // A new holding is shown in the Holdings list (no trades yet); its name opens the trades.
  await expect(page.getByRole('tab', { name: 'Holdings (1)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('row', { name: /MSCI World ETF/ })).toContainText('—');
  await page.getByRole('button', { name: 'MSCI World ETF', exact: true }).click();
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
  await expect(row).toContainText('120,50'); // the price, written like € amounts

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

test('a Zerodha holdings file becomes holdings and replaces the manual asset', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`zerodha-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  // The demat was tracked by hand as one asset so far.
  await page.getByRole('link', { name: 'Wealth' }).first().click();
  await page.getByRole('button', { name: 'Add asset' }).click();
  const a = page.getByRole('dialog');
  await a.getByLabel('Name').fill('Zerodha Surya');
  await a.getByLabel('Type').selectOption({ label: 'Investments' });
  await a.getByLabel('Belongs to').selectOption({ label: 'Surya' });
  await a.getByLabel('Current value').fill('6 L');
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(a).toBeHidden();

  await page.getByRole('link', { name: 'Investments' }).first().click();
  await page.getByRole('button', { name: 'Import from Zerodha' }).click();
  const d = page.getByRole('dialog', { name: 'Import holdings' });
  await expect(d.getByLabel('Whose demat is this?')).toHaveValue(/.+/); // the logged-in person
  await d.getByLabel('Holdings file (CSV)').setInputFiles({
    name: 'holdings.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        '"Instrument","Qty.","Avg. cost","LTP","Invested","Cur. val","P&L","Net chg.","Day chg.",""',
        '"INFY",32,1361.19,1088.9,43558.2,34844.8,-8713.4,-20,2.51,""',
        '"GOLDBEES",5030,62.21,119.72,312899.59,602191.6,289292.01,92.46,-1.06,""',
      ].join('\n'),
    ),
  });
  await expect(d.getByText('2 holdings', { exact: true })).toBeVisible();
  await expect(d.getByText('₹6,02,191.60')).toBeVisible();
  // The manual asset is suggested so the money is not counted twice.
  await expect(d.getByLabel('Already counted as a manual asset?')).not.toHaveValue('');
  await shot(page, '29-holdings-import');
  await d.getByRole('button', { name: 'Import 2 holdings' }).click();
  await expect(d.getByText('Done: 2 new, 0 updated.')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Done' })).toBeFocused();
  await d.getByRole('button', { name: 'Done' }).click();

  // Overview: what weighs most, and what moved most.
  const biggest = page.locator('section', {
    has: page.getByRole('heading', { name: 'Biggest holdings' }),
  });
  await expect(biggest.getByRole('listitem').first()).toContainText('GOLDBEES');
  await expect(biggest.getByRole('listitem').first()).toContainText('94.5 %');
  // Donuts: the account split and sectors (no NSE lists here, so INFY is not classified).
  const card = (title: string) =>
    page
      .locator('section', { has: page.getByRole('heading', { name: title, exact: true }) })
      .first();
  await expect(card('Account')).toContainText('Gold');
  await expect(card('Account')).toContainText('94.5 %');
  await expect(card('Sectors')).toContainText('Not classified');
  // A one-group split (all shares unclassified here) is not drawn as a donut.
  await expect(page.getByRole('heading', { name: /^Market cap/ })).toHaveCount(0);
  // Contributors to returns, in rupees.
  const performers = page.getByRole('region', { name: 'Top performers' });
  await expect(performers).toContainText('GOLDBEES');
  await expect(performers).toContainText('+₹2,89,292.01');
  await expect(page.getByRole('region', { name: 'Top decliners' })).toContainText('INFY');
  await expect(page.getByText('1 in profit · 1 in loss')).toBeVisible();
  await shot(page, '30-investments-overview');

  // Holdings: a broker-style table, sortable and searchable.
  await page.getByRole('tab', { name: 'Holdings (2)' }).click();
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows.nth(1)).toContainText('GOLDBEES'); // largest first
  await page.getByRole('button', { name: 'Net chg.' }).click(); // highest return first
  await page.getByRole('button', { name: 'Net chg.' }).click(); // then lowest first
  await expect(rows.nth(1)).toContainText('INFY');
  await expect(page.getByRole('columnheader', { name: /Net chg/ })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await expect(page.getByRole('table')).toContainText('Total');
  await expect(rows.nth(1)).toContainText('1,361.19'); // Indian style, to the paisa
  await page.getByLabel('Search holdings').fill('gold');
  await expect(page.getByText('1 of 2 holdings')).toBeVisible();
  await page.getByLabel('Search holdings').fill('');
  await shot(page, '31-investments-holdings');
  const value = page.locator('section', { has: page.getByText('Value', { exact: true }) }).first();
  await expect(value).toContainText('₹6,37,036.40');

  // Net worth can count the holdings at what was invested instead; the choice is kept.
  const countAt = page.getByLabel('Count in net worth and goals at');
  await expect(countAt).toHaveValue('value');
  await countAt.selectOption('invested');
  await page.reload();
  await expect(page.getByLabel('Count in net worth and goals at')).toHaveValue('invested');

  // Daily NSE prices are off until switched on; a failed download keeps the prices.
  const daily = page.getByLabel('Daily closing prices from NSE');
  await expect(daily).not.toBeChecked();
  await daily.click();
  await expect(daily).toBeChecked();
  await expect(page.getByText(/Could not update: .*The last prices are kept/)).toBeVisible();
  await expect(value).toContainText('₹6,37,036.40');
});
