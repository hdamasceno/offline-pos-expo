import { expect, test } from '@playwright/test';

test('sells while offline and syncs when the network returns', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('sync-status')).toHaveText('All synced');

  await page.getByRole('switch', { name: 'Network connection' }).click();
  await expect(page.getByTestId('sync-status')).toHaveText('Offline');

  await page.getByRole('button', { name: /^Add Orange juice, \$3\.99, 12 left/ }).click();
  await page.getByRole('button', { name: /^Add Orange juice/ }).click();
  await expect(page.getByTestId('cart-total')).toHaveText('$7.98');
  await page.getByRole('button', { name: 'Charge $7.98' }).click();

  await expect(page.getByTestId('receipt')).toHaveText('Sale saved · $7.98');
  await expect(page.getByTestId('sync-counts')).toContainText('1 pending');
  // Stock already reflects the unsynced sale.
  await expect(page.getByRole('button', { name: /^Add Orange juice, \$3\.99, 10 left/ })).toBeVisible();

  await page.getByRole('switch', { name: 'Network connection' }).click();
  await expect(page.getByTestId('sync-status')).toHaveText('All synced');
  await expect(page.getByTestId('sync-counts')).toContainText('0 pending');
});

test('a queued sale survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('switch', { name: 'Network connection' }).click();
  await page.getByRole('button', { name: /^Add Espresso/ }).click();
  await page.getByRole('button', { name: 'Charge $3.00' }).click();
  await expect(page.getByTestId('sync-counts')).toContainText('1 pending');

  await page.reload();
  // Back online after the reload; the persisted sale is sent.
  await expect(page.getByTestId('sync-counts')).toContainText('0 pending');
  await expect(page.getByTestId('sync-status')).toHaveText('All synced');
});

test('stacks the layout on a phone-sized screen without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('Current sale')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
