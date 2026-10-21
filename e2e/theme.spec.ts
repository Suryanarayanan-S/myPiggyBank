import { expect, test, type Page } from '@playwright/test';

const mode = (page: Page) => page.evaluate(() => document.documentElement.dataset.mode);

test('light or dark: follows the computer, or a choice that is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/register');
  expect(await mode(page)).toBe('dark');

  // The mode button cycles System → Light → Dark.
  const button = page.getByRole('button', { name: /^Colour mode: / });
  await expect(button).toHaveAccessibleName('Colour mode: System. Switch to Light');
  await button.click();
  expect(await mode(page)).toBe('light');
  await page.reload();
  expect(await mode(page)).toBe('light'); // set before the first paint, too

  await page.getByLabel('Your name').fill('Surya');
  await page.getByLabel('Email').fill(`mode-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Surya' })).toBeVisible();

  // Settings shows the same choice; System follows the computer again.
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
  await page.getByRole('radio', { name: 'System' }).check();
  expect(await mode(page)).toBe('dark');
  await page.getByRole('radio', { name: 'Dark' }).check();
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await mode(page)).toBe('dark');
});
