import { expect, test, type Page } from '@playwright/test';

const shot = async (page: Page, name: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/screenshots/${name}-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

test('the year report compares with last year, downloads as CSV and prints without navigation', async ({
  page,
}) => {
  const year = new Date().getFullYear();
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`reports-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();
  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Sparkasse');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  for (const [y, salary, rent] of [
    [year - 1, '4000', '1000'],
    [year, '5000', '1100'],
  ] as const) {
    await page.goto(`/budget/entry?month=${y}-01`);
    await page.getByLabel('Salary', { exact: true }).fill(salary);
    await page.getByLabel('Rent', { exact: true }).fill(rent);
    await page.getByRole('button', { name: 'Save month' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
  }

  await page.getByRole('link', { name: 'Reports' }).first().click();
  await expect(page.getByRole('heading', { name: `Year ${year}` })).toBeVisible();
  const tile = (label: string) =>
    page.locator('section', { has: page.getByText(label, { exact: true }) }).first();
  await expect(tile('Net income')).toContainText('5.000,00 €');
  await expect(tile('Net income')).toContainText(`+25.0 % vs Jan ${year - 1}`);
  await expect(
    page.getByText(`1 of 12 months recorded · compared with Jan ${year - 1} (the same months)`, {
      exact: false,
    }),
  ).toBeVisible();
  const rent = page.getByRole('row', { name: /^Rent/ });
  await expect(rent).toContainText('1.100,00 €');
  await expect(rent).toContainText('1.000,00 €');
  await expect(rent).toContainText('+10.0 %');
  await expect(page.getByRole('link', { name: 'CSV' })).toHaveAttribute(
    'href',
    `/api/reports/year/${year}.csv`,
  );
  await shot(page, '29-reports');

  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('link', { name: 'Dashboard' }).first()).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await page.screenshot({ path: 'e2e/screenshots/30-reports-print.png', fullPage: true });
  await page.emulateMedia({ media: 'screen' });

  await page.getByRole('button', { name: 'Previous year' }).click();
  await expect(page.getByRole('heading', { name: `Year ${year - 1}` })).toBeVisible();
  await expect(page.getByText(`nothing recorded in ${year - 2} to compare with`)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow, 'the page must not scroll sideways on a phone').toBe(false);
});
