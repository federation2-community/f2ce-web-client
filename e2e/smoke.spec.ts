import { test, expect } from '@playwright/test';

test('app boots and the branded Landing renders both actions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /log in/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /create a new character/i })).toBeVisible();
  await expect(page.getByText(/start a brand-new character/i)).toBeVisible();
  expect(errors, `uncaught page errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('assets are served under the / base', async ({ page }) => {
  const resp = await page.goto('/');
  expect(resp?.status()).toBe(200);
  expect(await page.content()).toMatch(/\/assets\//);
});
