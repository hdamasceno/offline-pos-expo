import { test } from '@playwright/test';

// Regenerates the README images: npm run screenshots
test.skip(!process.env.SCREENSHOTS, 'only when SCREENSHOTS=1');

test('README screenshot: offline sale waiting to sync', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto('/');
  await page.getByRole('switch', { name: 'Network connection' }).click();
  await page.getByRole('button', { name: /^Add Oat latte/ }).click();
  await page.getByRole('button', { name: 'Charge $4.75' }).click();
  await page.getByText('1 pending').waitFor();
  for (const name of [/^Add Butter croissant/, /^Add Butter croissant/, /^Add Logo mug/, /^Add Espresso/]) {
    await page.getByRole('button', { name }).click();
  }
  await page.getByRole('radio', { name: '5% off' }).click();
  await page.screenshot({ path: 'docs/screenshot-wide.png' });
});

test('README screenshot: phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /^Add Sesame bagel/ }).click();
  await page.getByRole('button', { name: /^Add Orange juice/ }).click();
  await page.screenshot({ path: 'docs/screenshot-phone.png' });
});
