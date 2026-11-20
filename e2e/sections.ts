import type { Page } from '@playwright/test';

const TREASURE = ['Investments', 'Wealth', 'Analytics'];

/** Opens a section from the side menu, switching workspace first when it is in the other one. */
export async function openSection(page: Page, name: string) {
  const link = page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name, exact: true });
  // the menu is there before deciding (it renders with the page)
  await page.getByRole('navigation', { name: 'Sections' }).waitFor();
  if (!(await link.isVisible())) {
    await page
      .getByRole('navigation', { name: 'Workspaces' })
      .getByRole('link', { name: TREASURE.includes(name) ? /^The Treasure/ : /^The Pocket/ })
      .first()
      .click();
  }
  await link.click();
}
