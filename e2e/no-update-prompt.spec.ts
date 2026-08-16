import { test, expect } from '@playwright/test';

/**
 * Regression guard: the browser client must never register an in-client
 * package-update checker.
 *
 * On web the page owns the package lifecycle — mudlet-web installs
 * f2ce-tools at load and reinstalls it silently whenever the manifest
 * version differs from the one the build pinned. f2ce-tools used to *also*
 * register itself as a Muxlet update host (bootHostOpts' `updateRepo`), so
 * Muxlet polled our GitHub releases at startup and raised its "a new build
 * is available" dialog on top of that — asking the user to approve
 * something the page had already decided.
 *
 * Asserting "no dialog appeared" would be worthless here: it also passes
 * when there simply is no newer release to offer. So probe the state that
 * makes the dialog possible instead. Requires the dev/test build (the
 * `lua` alias ships in mudlet-web's run-lua-code, which brand.ts includes
 * only when VITE_SHOW_TOOLBAR=true).
 *
 * Run against a live scripts/dev-stack.sh — see playwright.stack.config.ts.
 */
test('web client registers no package-update checker', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#f2ce-landing-name')).toBeVisible({ timeout: 15_000 });
  await page.fill('#f2ce-landing-name', 'Test');
  await page.fill('#f2ce-landing-password', 'anypassword');
  await page.getByRole('button', { name: /^log in$/i }).click();

  // f2ce-tools' stats readout is the "Muxlet booted and f2tInit ran" signal —
  // both halves of the change (bootHostOpts and f2tInit) have executed by
  // then. Deliberately NOT the Galaxy button that stack-smoke.spec.ts waits
  // on: f2ce-tools 896e105 reduced it to a bare icon, so its label no longer
  // exists in the DOM.
  await expect(page.getByText(/Groats:/i).first()).toBeVisible({ timeout: 45_000 });

  const cmdInput = page.locator('textarea.command-input');
  await cmdInput.click();
  await cmdInput.fill(
    'lua "F2TPROBE web=" .. tostring(f2t_is_web()) ' +
      '.. " host=" .. tostring(Mux._hostUpdate) ' +
      '.. " muxcheck=" .. tostring(Mux.settings.get("muxupdate", "update_check_enabled")) ' +
      '.. " f2tcheck=" .. tostring(Mux.settings.get("f2t", "update_check_enabled"))',
  );
  await cmdInput.press('Enter');

  const probe = page.getByText(/F2TPROBE/).first();
  await expect(probe).toBeVisible({ timeout: 15_000 });
  const line = (await probe.textContent()) ?? '';

  // Sanity: this only proves anything if we really are on the web path.
  expect(line).toContain('web=true');

  // Mux._hostUpdate is set by Mux.configureHost only when a host passes
  // updateRepo (Muxlet update.lua). nil = no host registered = nothing polls
  // f2ce-tools' releases and the update dialog has no trigger.
  expect(line).toContain('host=nil');

  // With no host registered Muxlet falls back to polling for its OWN
  // releases, which would offer to update away from the version f2ce-tools
  // pins. bootHostOpts' checkForUpdates=false is what stops that, and on web
  // it is load-bearing rather than belt-and-braces.
  expect(line).toContain('muxcheck=false');

  // The host's settings rows follow updateRepo, so the toggle the desktop
  // build opts into should not exist here at all.
  expect(line).toContain('f2tcheck=nil');
});
