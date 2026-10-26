import { expect, test } from '@playwright/test';

const HEAD =
  'datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code';
const row = (o: Record<string, string>) =>
  HEAD.split(',')
    .map((k) => o[k] ?? '')
    .join(',');
// a Trade Republic export's shape, values made up
const tradeRepublic = [
  HEAD,
  row({
    date: '2025-09-11',
    category: 'CASH',
    type: 'TRANSFER_INBOUND',
    amount: '50.000000',
    currency: 'EUR',
    transaction_id: 'c1',
  }),
  row({
    date: '2025-09-11',
    category: 'TRADING',
    type: 'BUY',
    asset_class: 'STOCK',
    name: 'Toyota Motor',
    symbol: 'JP3633400001',
    shares: '2.0000000000',
    price: '16.80',
    amount: '-33.60',
    fee: '-1.00',
    currency: 'EUR',
    transaction_id: 't1',
  }),
  row({
    date: '2025-11-26',
    category: 'CASH',
    type: 'DIVIDEND',
    asset_class: 'STOCK',
    name: 'Toyota Motor',
    symbol: 'JP3633400001',
    shares: '2.0000000000',
    amount: '0.570000',
    tax: '-0.07',
    currency: 'EUR',
    transaction_id: 't2',
  }),
].join('\n');

test('a Trade Republic export becomes euro holdings in a broker account, with its dividends', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`world-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  await page.goto('/investments/market');
  await page.getByRole('button', { name: 'Import from Trade Republic' }).click();
  const d = page.getByRole('dialog', { name: 'Import from Trade Republic' });
  // no euro broker account yet: one is made on the spot
  await d.getByLabel('Broker account name').fill('Trade Republic');
  await d.getByRole('button', { name: 'Add broker account' }).click();
  await expect(d.getByLabel('Which account is this?')).not.toHaveValue('new');
  await d.getByLabel('Transactions export (CSV)').setInputFiles({
    name: 'transactions.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(tradeRepublic),
  });
  await expect(d.getByText('new holding · 1 trades, 1 dividends new · 2 shares')).toBeVisible();
  await expect(d.getByText('Left out: 1 × transfer_inbound.')).toBeVisible();
  await d.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(d.getByText(/Done: 2 rows imported, 1 new holdings/)).toBeVisible();
  await d.getByRole('button', { name: 'Done' }).click();

  // in the demat table as its own account, and in Holdings in euros
  await expect(page.getByRole('table', { name: 'Holdings by demat account' })).toContainText(
    'Trade Republic',
  );
  await page.getByRole('tab', { name: /Holdings/ }).click();
  await expect(page.getByRole('table', { name: 'Holdings, sortable by column' })).toContainText(
    'Toyota Motor',
  );
  // the dividend, in euros, with the shares held
  await page.getByRole('tab', { name: 'Dividends' }).click();
  await page.getByLabel('Period').selectOption({ label: 'All years' });
  const payouts = page.getByRole('table', { name: /dividends from/ });
  await expect(payouts.getByRole('row').nth(1)).toContainText('JP3633400001');
  await expect(payouts.getByRole('row').nth(1)).toContainText('0,57');

  // importing the same export again adds nothing
  await page.getByRole('button', { name: 'Import from Trade Republic' }).click();
  await d.getByLabel('Transactions export (CSV)').setInputFiles({
    name: 'transactions.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(tradeRepublic),
  });
  await expect(d.getByRole('button', { name: 'Nothing new to import' })).toBeDisabled();
});
