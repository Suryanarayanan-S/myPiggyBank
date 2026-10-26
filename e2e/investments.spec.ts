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
  await page
    .getByRole('navigation', { name: 'Investments pages' })
    .getByRole('link', { name: 'Market' })
    .click();
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

  // The two latest weekdays' prices (weekends are no market days): the move is 12,5 × 2,50.
  const weekdays = [0, 1, 2, 3, 4, 5]
    .map(daysAgo)
    .filter((x) => ![0, 6].includes(new Date(`${x}T00:00:00Z`).getUTCDay()));
  await d.locator('#p-date').fill(weekdays[1]!);
  await d.getByLabel('Price per unit (EUR)').fill('118,00');
  await d.getByRole('button', { name: 'Save price' }).click();
  await expect(d.getByText('118 EUR')).toBeVisible();
  await d.locator('#p-date').fill(weekdays[0]!);
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
  // …but its day's move needs no rate.
  await expect(row.getByRole('cell').nth(8)).toHaveText('2.1 %');
  await page
    .getByRole('combobox', { name: 'Show amounts in' })
    .filter({ visible: true })
    .selectOption('EUR');
  const value = page.locator('section', { has: page.getByText('Value', { exact: true }) }).first();
  await expect(value).toContainText('1.506,25 €');
  await expect(
    page
      .locator('section', { has: page.getByText('Dividends & interest', { exact: true }) })
      .first(),
  ).toContainText('12,40 €');
  await shot(page, '26-investments');
  // Contributors to returns: overall, or the latest market day.
  await page.getByRole('tab', { name: 'Overview' }).click();
  const contrib = page.locator('section', { has: page.getByText('Contributors to returns') });
  await expect(contrib.getByLabel('Top performers', { exact: true })).toContainText('+211,90 €');
  await contrib.getByRole('button', { name: /^Day · / }).click();
  await expect(contrib.getByLabel('Top performers of the day')).toContainText('+31,25 €');
  await expect(contrib.getByLabel('Top performers of the day')).toContainText('2.1 %');
  await expect(contrib.getByLabel('Top decliners of the day')).toContainText('None');
  // The Dashboard shows the day's move too (in euros, the summary currency here).
  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  const invest = page.locator('section', {
    has: page.getByRole('heading', { name: 'Investments' }),
  });
  await expect(invest).toContainText('1.506,25 €');
  await expect(invest).toContainText('+31,25 €');
  await page.getByRole('link', { name: 'Investments' }).first().click();
  await page
    .getByRole('navigation', { name: 'Investments pages' })
    .getByRole('link', { name: 'Market' })
    .click();
  // …and the Day choice is remembered.
  await expect(contrib.getByLabel('Top performers of the day')).toBeVisible();
  await contrib.getByRole('button', { name: 'Overall' }).click();
  // …and in the holdings table, next to the overall change.
  await page.getByRole('tab', { name: /Holdings/ }).click();
  await expect(page.getByRole('button', { name: 'Day chg.' })).toBeVisible();
  await expect(
    page
      .getByRole('row', { name: /MSCI World ETF/ })
      .getByRole('cell')
      .nth(8),
  ).toHaveText('2.1 %');
  await page.getByRole('tab', { name: 'Overview' }).click();

  // Compared with Nifty 50 and gold: market data stands in (the test server is offline).
  const days = [90, 60, 30, 5, 0].map(daysAgo);
  await page.route('**/api/holdings/benchmarks', (route) =>
    route.fulfill({
      json: {
        data: {
          nifty50: days.map((date, i) => ({ date, value: 24_000 + i * 300 })),
          gold: days.map((date, i) => ({ date, value: 60 + i * 4 })),
          gold22k: days.map((date, i) => ({ date, value: 13_000 + i * 100 })),
          gold24k: days.map((date, i) => ({ date, value: 14_200 + i * 110 })),
          goldUsd: [{ date: days[4], value: 4132.9 }], // collected from today only
        },
      },
    }),
  );
  await page.getByLabel('Daily closing prices from NSE').click();
  await expect(page.getByLabel('Daily closing prices from NSE')).toBeChecked();
  await page.getByRole('tab', { name: 'Performance' }).click();
  // One chart, each line ticked on or off; ticked by default: yours, Nifty 50 and 22K gold.
  await expect(page.getByLabel('Your investments')).toBeChecked();
  await expect(page.getByLabel('Nifty 50')).toBeChecked();
  await expect(page.getByLabel('Gold 22K per gram')).toBeChecked();
  await expect(page.getByLabel('Gold 24K per gram')).not.toBeChecked();
  await expect(page.getByLabel('GOLDBEES ETF')).not.toBeChecked();
  await expect(page.getByLabel('Gold, world price ($ per ounce)')).not.toBeChecked();
  const compare = page.locator('section', { has: page.getByText(/^Change since/) });
  await expect(compare).toContainText('Gold 22K (IBJA)');
  await compare.getByRole('button', { name: 'Show table' }).click();
  // values next to the change: 22K 13,000 → 13,400 per gram; yours in its own currency
  await expect(compare.getByRole('row').last()).toContainText('₹13,400/g (+3.1 %)');
  await expect(compare.getByRole('row').last()).toContainText('1.506,25 € (+20.5 %)');
  await compare.getByRole('button', { name: 'Show chart' }).click();
  await shot(page, '35-investments-vs-nifty-gold');
  // 22K and 24K move alike: their end labels are spread apart, not drawn on top of each other.
  await page.getByLabel('Gold 24K per gram').click();
  await expect(compare).toContainText('Gold 24K (IBJA)');
  await shot(page, '36-investments-gold-labels');
  await page.getByLabel('Gold 24K per gram').click();
  // World gold has only today so far: it says so, and unticking brings the chart back.
  await page.getByLabel('Gold, world price ($ per ounce)').click();
  await expect(page.getByText(/two days in common/)).toBeVisible();
  await page.getByLabel('Gold, world price ($ per ounce)').click();
  await expect(compare).toContainText('Nifty 50');
  // GOLDBEES is a line of its own, next to 22K gold.
  await page.getByLabel('GOLDBEES ETF').click();
  await expect(compare).toContainText('GOLDBEES ETF');
  await expect(compare).toContainText('Gold 22K (IBJA)');
  // Without yours, only the markets are compared.
  await page.getByLabel('Your investments').click();
  await expect(compare).not.toContainText('without money added');
  // The choice is remembered.
  await page.reload();
  await expect(page.getByLabel('GOLDBEES ETF')).toBeChecked();
  await expect(page.getByLabel('Your investments')).not.toBeChecked();
  await page.getByLabel('Your investments').click();
  await page.getByLabel('GOLDBEES ETF').click();
  await expect(page.getByLabel('Your investments')).toBeChecked();
  await expect(page.getByLabel('GOLDBEES ETF')).not.toBeChecked();
  await page.getByLabel('Daily closing prices from NSE').click();

  await page.setViewportSize({ width: 390, height: 844 });
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
  await page
    .getByRole('navigation', { name: 'Investments pages' })
    .getByRole('link', { name: 'Market' })
    .click();
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

  // Dividends (worked out from NSE each day; offline here, so two are recorded directly).
  const held = (await (await page.request.get('/api/holdings')).json()).data.holdings;
  const infyId = held.find((h: { symbol: string }) => h.symbol === 'INFY').id;
  for (const [ago, amount] of [
    [130, 59_800],
    [10, 75_000],
  ]) {
    await page.request.post(`/api/holdings/${infyId}/trades`, {
      data: { date: daysAgo(ago), type: 'dividend', amount },
    });
  }
  await page.reload();
  await page.getByRole('tab', { name: 'Dividends' }).click();
  // where each came from and when (like Console's report), and a CSV of it
  await expect(page.getByText('Total dividend', { exact: true }).locator('..')).toContainText(
    '₹1,348.00',
  );
  await expect(
    page.getByText('No. of dividends received', { exact: true }).locator('..'),
  ).toContainText('2');
  const payouts = page.getByRole('table', { name: /dividends from/ });
  await expect(payouts.getByRole('row')).toHaveCount(3);
  await expect(payouts.getByRole('row').nth(1)).toContainText('INFY');
  await expect(payouts.getByRole('row').nth(1)).toContainText('₹750.00');
  await page.getByPlaceholder('Search…').fill('gold');
  await expect(page.getByText('No dividends match the search.')).toBeVisible();
  await page.getByPlaceholder('Search…').fill('');
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  expect((await csv).suggestedFilename()).toMatch(/^dividend_\d{4}-\d{2}-\d{2}_to_/);
  const income = page.locator('section', {
    has: page.getByRole('heading', { name: 'Dividend and interest' }),
  });
  await expect(income).toContainText('₹1,348.00 from 2 payouts');
  await income.getByRole('button', { name: 'Show table' }).click();
  await expect(income.getByRole('row').filter({ hasText: '₹750.00' })).toHaveCount(1);
  await income.getByRole('button', { name: 'Show chart' }).click();
  await expect(
    page
      .locator('section', { has: page.getByText('Dividends & interest', { exact: true }) })
      .first(),
  ).toContainText('₹1,348.00');

  // Overview: what weighs most, and what moved most.
  await page.getByRole('tab', { name: 'Overview' }).click();
  const biggest = page.locator('section', {
    has: page.getByRole('heading', { name: 'Biggest holdings' }),
  });
  await expect(biggest.getByRole('listitem').first()).toContainText('GOLDBEES');
  await expect(biggest.getByRole('listitem').first()).toContainText('94.5 %');
  // A split from NSE's corporate-actions list (offline here: added to the real answer).
  await page.route(/\/api\/holdings(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    const infy = json.data.holdings.find((h: { name: string }) => h.name === 'INFY');
    infy.actions = [
      {
        exDate: new Date().toISOString().slice(0, 10),
        purpose: 'FVSPLT FRM RS 10 TO RS 2',
        kind: 'split',
        status: 'applied',
        unitsBefore: '32',
        unitsAfter: '160',
      },
    ];
    await route.fulfill({ response: res, json });
  });
  await page.reload();
  const actions = page.locator('section', {
    has: page.getByRole('heading', { name: 'Splits and bonus issues' }),
  });
  await expect(actions).toContainText('units 32 → 160, earlier prices adjusted to match');
  await actions.getByRole('button', { name: 'INFY' }).click();
  await expect(page.getByRole('dialog', { name: /INFY/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.unroute(/\/api\/holdings(\?.*)?$/);
  await page.reload();
  await expect(actions).toHaveCount(0);
  // Donuts: the account split and sectors (no NSE lists here, so INFY is not classified).
  const card = (title: string) =>
    page
      .locator('section', { has: page.getByRole('heading', { name: title, exact: true }) })
      .first();
  await expect(card('Account')).toContainText('Gold');
  await expect(card('Account')).toContainText('94.5 %');
  // Under each donut: shares of the money invested (87.8 % = 3,12,899.59 of 3,56,457.79).
  await card('Account').getByRole('button', { name: 'Invested' }).click();
  await expect(card('Account').getByRole('button', { name: 'Invested' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(card('Account')).toContainText('87.8 %');
  await expect(card('Account')).toContainText('12.2 %');
  await card('Account').getByRole('button', { name: 'Show table' }).click();
  await expect(card('Account').getByRole('row', { name: /Gold/ })).toContainText('₹3,12,899.59');
  await card('Account').getByRole('button', { name: 'Show chart' }).click();
  // Each donut remembers its switch; the other donuts keep their own.
  await page.reload();
  await expect(card('Account').getByRole('button', { name: 'Invested' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(card('Sectors').getByRole('button', { name: 'Current' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await card('Account').getByRole('button', { name: 'Current' }).click();
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
  await expect(page.getByRole('table', { name: 'Holdings, sortable by column' })).toContainText(
    'Total',
  );
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
  // saved before the reload (the page saves in the background)
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/family') && r.request().method() === 'PUT'),
    countAt.selectOption('invested'),
  ]);
  await page.reload();
  await expect(page.getByLabel('Count in net worth and goals at')).toHaveValue('invested');

  // Daily NSE prices are off until switched on; a failed download keeps the prices.
  const daily = page.getByLabel('Daily closing prices from NSE');
  await expect(daily).not.toBeChecked();
  await daily.click();
  await expect(daily).toBeChecked();
  await expect(page.getByText(/Could not update: .*The last prices are kept/)).toBeVisible();

  // Value over time: the comparison with Nifty 50 and gold needs NSE data (none here).
  await page.getByRole('tab', { name: 'Performance' }).click();
  // Markets without prices yet are named and left out; yours needs a second day first.
  await expect(page.getByText(/No prices yet for Nifty 50, Gold 22K/)).toBeVisible();
  await expect(page.getByText(/Each day with prices adds a point/)).toBeVisible();
  await expect(value).toContainText('₹6,37,036.40');
  // A choice saved before every line had its own tick box is carried over.
  await page.evaluate(() =>
    localStorage.setItem(
      'pb-compare',
      JSON.stringify({ nifty50: false, goldIndiaOn: true, goldIndia: 'gold24k', goldUsd: true }),
    ),
  );
  await page.reload();
  await expect(page.getByLabel('Nifty 50')).not.toBeChecked();
  await expect(page.getByLabel('Gold 22K per gram')).not.toBeChecked();
  await expect(page.getByLabel('Gold 24K per gram')).toBeChecked();
  await expect(page.getByLabel('Gold, world price ($ per ounce)')).toBeChecked();
  // The full tradebook: real buy dates (INFY in two lots, GOLDBEES in one), and the XIRR.
  await page.getByRole('button', { name: 'Import tradebook' }).click();
  const tb = page.getByRole('dialog', { name: 'Import tradebook' });
  await tb.getByLabel('Tradebook (CSV)').setInputFiles({
    name: 'tradebook.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time',
        `INFY,X,${daysAgo(900)},NSE,EQ,EQ,buy,false,20,1300,1,1,x`,
        `INFY,X,${daysAgo(400)},NSE,EQ,EQ,buy,false,12,1450.5,2,2,x`,
        `GOLDBEES,X,${daysAgo(700)},NSE,EQ,EQ,buy,false,5030,62.21,3,3,x`,
        `ADANIPORTS,X,${daysAgo(800)},NSE,EQ,EQ,buy,false,10,745.83,4,4,x`,
        `ADANIPORTS,X,${daysAgo(780)},NSE,EQ,EQ,sell,false,10,682.04,5,5,x`,
      ].join('\n'),
    ),
  });
  await expect(tb.getByText('5 trades')).toBeVisible();
  await expect(tb.getByText(/2 holdings get their real trades · 1 bought and sold/)).toBeVisible();
  await tb.getByRole('button', { name: 'Use the trades for 3 holdings' }).click();
  await expect(tb.getByText(/Done: 2 holdings got their trades, 1 sold ones/)).toBeVisible();
  await tb.getByRole('button', { name: 'Done' }).click();
  await expect(
    page.locator('section', { has: page.getByText('XIRR', { exact: true }) }).first(),
  ).toContainText(/[+−-]\d+\.\d %/);
  // Bought and sold entirely: archived, with what the sale booked (10 × (682.04 − 745.83))
  const adani = page.getByRole('row').filter({ hasText: 'ADANIPORTS' });
  await expect(adani).toContainText('−₹637.90');
  await expect(adani).toContainText('booked');

  // The tradebook started a dividend check on NSE (offline here: it says so), and one can be
  // asked for again.
  await page.getByRole('tab', { name: 'Dividends' }).click();
  await expect(page.getByText(/NSE did not answer as expected/)).toBeVisible();
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByText(/Dividends and gold bond interest are checked on NSE/)).toBeVisible();
  await expect(page.getByText(/NSE did not answer as expected/)).toBeVisible();
});
