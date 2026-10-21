import { expect, test, type Page } from '@playwright/test';
import { buildWorkbook } from '../backend/test/fixtures/workbook';

const look = (page: Page) => page.evaluate(() => ({ ...document.documentElement.dataset }));

test('one click switches between modern and retro; the choice is remembered', async ({ page }) => {
  await page.goto('/register');
  expect(await look(page)).toMatchObject({ style: 'modern' });

  await page.getByRole('button', { name: 'Switch to retro look' }).click();
  expect(await look(page)).toMatchObject({ style: 'retro', mode: 'light' });
  const intro = page.getByRole('dialog', { name: 'myPiggyBank start screen' });
  await expect(intro).toBeVisible();
  await expect(intro.getByText('PRESS START')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/screenshots/18-retro-start.png' });
  await page.keyboard.press('Enter');
  await expect(intro).toBeHidden();
  expect(await page.evaluate(() => document.fonts.check('12px "Press Start 2P"'))).toBe(true);

  await page.reload();
  expect(await look(page)).toMatchObject({ style: 'retro' });
  await expect(intro).toBeHidden(); // shown once per visit

  // Register, import a little history and look at the main pages in retro.
  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`retro-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();
  const d = new Date();
  const name = (back: number) => {
    const x = new Date(d.getFullYear(), d.getMonth() - back, 1);
    return `${x.toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3)} ${String(x.getFullYear()).slice(2)}`;
  };
  const sheet = (back: number) => ({
    name: name(back),
    income: [['Salary', 3750]] as [string, number][],
    essentials: [
      ['Rent', 912],
      ['Groceries', 296],
    ] as [string, number][],
    fun: [['Restaurant', 172 + back * 40]] as [string, number][],
    future: [['Stocks', 580]] as [string, number][],
  });
  await page.getByRole('link', { name: 'Transactions' }).first().click();
  await page.getByRole('link', { name: 'Import' }).first().click();
  await page.locator('#import-file').setInputFiles({
    name: 'm.xlsx',
    mimeType: 'application/octet-stream',
    buffer: await buildWorkbook([sheet(2), sheet(1), sheet(0)]),
  });
  await page.getByRole('button', { name: 'Import 3 months' }).click();
  await expect(page.getByText(/Imported 15 transactions/)).toBeVisible();

  for (const [link, file] of [
    ['Dashboard', '19-retro-dashboard'],
    ['Budget', '20-retro-budget'],
    ['Settings', '21-retro-settings'],
  ] as const) {
    await page.getByRole('link', { name: link }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e/screenshots/${file}.png`, fullPage: true });
  }
  // Retro dark: the mode button cycles System → Light → Dark.
  const mode = page.getByRole('button', { name: /^Colour mode: / }).first();
  await expect(mode).toHaveAccessibleName('Colour mode: System. Switch to Light');
  await mode.click();
  await mode.click();
  expect(await look(page)).toMatchObject({ style: 'retro', mode: 'dark' });
  for (const [link, file] of [
    ['Dashboard', '32-retro-dark-dashboard'],
    ['Budget', '33-retro-dark-budget'],
    ['Settings', '34-retro-dark-settings'],
  ] as const) {
    await page.getByRole('link', { name: link }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e/screenshots/${file}.png`, fullPage: true });
  }
  // Settings shows the same choices, and the choice is kept.
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Retro/ })).toBeChecked();
  await page.reload();
  expect(await look(page)).toMatchObject({ style: 'retro', mode: 'dark' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Dashboard' }).last().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/22-retro-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });

  // …and back to modern with one click (following the system dark mode).
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'Switch to modern look' }).first().click();
  expect(await look(page)).toMatchObject({ style: 'modern', mode: 'dark' });

  // A fixed choice wins over the computer's setting; System follows it again.
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByRole('radio', { name: 'Light' }).check();
  expect(await look(page)).toMatchObject({ style: 'modern', mode: 'light' });
  await page.getByRole('radio', { name: 'System' }).check();
  expect(await look(page)).toMatchObject({ style: 'modern', mode: 'dark' });
});

test('the start screen is skipped for people who prefer reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/register');
  await page.getByRole('button', { name: 'Switch to retro look' }).click();
  expect(await look(page)).toMatchObject({ style: 'retro' });
  await expect(page.getByRole('dialog', { name: 'myPiggyBank start screen' })).toBeHidden();
});
