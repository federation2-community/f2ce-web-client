import { test, expect } from '@playwright/test';

/**
 * Full-stack smoke test — the browser-behavior gap the engine-only telnet
 * e2e test can't see (Muxlet/f2ce-tools init, GMCP Char.Login timing, the
 * terminal actually rendering). Run against a live `scripts/dev-stack.sh`
 * (fed2d + f2ce-proxy + this app's vite dev server); see
 * playwright.stack.config.ts and docs/local-dev.md.
 *
 * Muxlet-ready signal: f2ce-tools' `f2t` alias
 * (fed2-tools/src/aliases/f2t.lua) replies "Muxlet isn't ready yet; try
 * again in a moment." if the underlying Muxlet framework hasn't finished
 * installing/initializing yet, and "[f2t] f2ce-tools UI is on." once it has.
 * That message is the most reliable init signal available without coupling
 * this test to mudlet-web's internal (minified, no test-ids) DOM structure.
 * As a secondary, DOM-based check we also assert a couple of f2ce-tools UI
 * elements (the player's Groats/Rank readout and the Galaxy button) render.
 *
 * TODO: if a future mudlet-web/f2ce-tools release exposes a stable
 * data-testid for "Muxlet is ready", prefer that over the text assertions
 * below — it would be less sensitive to copy changes in f2t.lua.
 */
test('logs in against the local stack and Muxlet/f2ce-tools initializes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');

  // --- Landing: log in as the local "Test" account. Local-mode fed2d
  // accepts any password for an existing character (see
  // fed2-community CLAUDE.md / Player::IsPassword()). ---
  await expect(page.locator('#f2ce-landing-name')).toBeVisible({ timeout: 15_000 });
  await page.fill('#f2ce-landing-name', 'Test');
  await page.fill('#f2ce-landing-password', 'anypassword');
  await page.getByRole('button', { name: /^log in$/i }).click();

  // --- Connects + logs in: fed2d's banner and room text land in the
  // terminal. This is the "engine reachable through the real browser
  // client" assertion the telnet-only e2e can't make. ---
  // mudlet-web renders each terminal line twice (a visible span plus an
  // ARIA-live mirror for screen readers), so scope to the first match.
  await expect(page.getByText(/Welcome to Fed2 Community Edition/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/You can see .*exit/i).first()).toBeVisible({ timeout: 10_000 });

  // --- Muxlet/f2ce-tools: web onboarding auto-installs+enables on first
  // run (see fed2-web-client-integration memory) by downloading a package
  // over the network (through the proxy's CORS forwarder), so this takes a
  // few real seconds. Wait for its UI (the Galaxy button, part of
  // f2ce-tools' toolbar) rather than racing it — this is the DOM-based
  // "Muxlet is ready" signal. ---
  await expect(page.getByText(/Galaxy/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Groats:/i).first()).toBeVisible();

  // --- Confirm via the command input too (the same path a real player
  // would use to check f2t's state), now that init has had time to finish. ---
  const cmdInput = page.locator('textarea.command-input');
  await cmdInput.click();
  await cmdInput.fill('f2t on');
  await cmdInput.press('Enter');

  await expect(page.getByText(/f2ce-tools UI is on/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Muxlet isn't ready/i)).toHaveCount(0);

  expect(errors, `uncaught page errors: ${errors.join('\n')}`).toHaveLength(0);
});
