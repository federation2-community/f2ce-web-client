import { test, expect, type Page } from '@playwright/test';

/**
 * Full-stack smoke test for the one-shot GMCP character-creation feature
 * (`Char.Create` / `Char.Create.CheckName` — fed2-community branch
 * `gmcp-char-create`, client-side form in `src/Landing.tsx`). Run against a
 * live `scripts/dev-stack.sh` (fed2d + f2ce-proxy + this app's vite dev
 * server), same style/config as `e2e/stack-smoke.spec.ts`.
 *
 * This is the pre-push gate for the feature: it proves the create form's
 * live name-check, the create->login handoff, and the post-login
 * Muxlet/f2ce-tools char-burst all work together through a real browser,
 * not just against mocked GMCP (see `src/Landing.test.tsx` for the unit
 *-level coverage of the same code).
 */

// Alpha-only per the engine's name rule (Login::ValidateNewAccountName: 3-15
// letters, no digits/spaces) mirrored in Landing.tsx's NAME_RE. A fresh
// random name each run avoids colliding with characters created by a
// previous run against this same persistent local DB.
function uniqueName(prefix: string): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += letters[Math.floor(Math.random() * letters.length)];
  }
  return prefix + suffix;
}

async function openCreateForm(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /create a new character/i })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /create a new character/i }).click();
  await expect(page.locator('#f2ce-create-name')).toBeVisible();
}

test.describe('Char.Create (one-shot GMCP create)', () => {
  test('case 1: create form opens from Landing, every field + submit fit on screen (issue #1)', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await openCreateForm(page);

    await expect(page.locator('#f2ce-create-password')).toBeVisible();
    await expect(page.locator('#f2ce-create-confirm-password')).toBeVisible();
    await expect(page.locator('#f2ce-create-email')).toBeVisible();
    await expect(page.locator('#f2ce-create-race')).toBeVisible();
    await expect(page.locator('#f2ce-create-strength')).toBeVisible();
    await expect(page.locator('#f2ce-create-stamina')).toBeVisible();
    await expect(page.locator('#f2ce-create-dexterity')).toBeVisible();
    // Intelligence: read-only 4th stat tile, same size/style as the other
    // three (issue #4) — derived from the 35/35/35 defaults.
    const intelligence = page.locator('#f2ce-create-intelligence');
    await expect(intelligence).toBeVisible();
    await expect(intelligence).toHaveValue('35');
    await expect(intelligence).toBeDisabled();
    // The old "140 stat points..." caption under the title is gone (issue #6).
    await expect(page.getByText(/stat points to distribute — strength, stamina and dexterity/i)).toHaveCount(0);

    const submit = page.getByRole('button', { name: /^create character$/i });
    await expect(submit).toBeVisible();
    await expect(submit).toBeInViewport();
    await expect(submit).toBeEnabled();

    expect(errors, `uncaught page errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('case 2: live CheckName reports taken vs available', async ({ page }) => {
    await openCreateForm(page);
    const nameInput = page.locator('#f2ce-create-name');

    // "Test" is a pre-existing local character (see fed2-community
    // CLAUDE.md / local e2e recipe) -> must come back taken.
    await nameInput.fill('Test');
    await nameInput.blur();
    await expect(page.locator('.f2ce-namecheck-taken')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.f2ce-namecheck-taken')).toContainText(/already taken/i);

    // A fresh random alpha name -> must come back available.
    const fresh = uniqueName('Zzt');
    await nameInput.fill(fresh);
    await nameInput.blur();
    await expect(page.locator('.f2ce-namecheck-available')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.f2ce-namecheck-available')).toContainText(/available/i);
  });

  test('case 3: happy path — create, log in, and f2ce-tools/Muxlet loads', async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    const charName = uniqueName('Zorion');
    await openCreateForm(page);

    await page.locator('#f2ce-create-name').fill(charName);
    await page.locator('#f2ce-create-password').fill('SuperSecret123');
    await page.locator('#f2ce-create-confirm-password').fill('SuperSecret123');
    await page.locator('#f2ce-create-email').fill(`${charName.toLowerCase()}@example.com`);
    await page.locator('#f2ce-create-race').fill('human');
    await page.getByRole('radio', { name: /^male$/i }).check();
    // Default stats (35/35/35, intelligence derived to 35) are already a
    // valid 140-point allocation — leave them as-is.

    await expect(page.locator('.f2ce-namecheck-available')).toBeVisible({ timeout: 10_000 });
    const submit = page.getByRole('button', { name: /^create character$/i });
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await submit.click();

    // Create -> login handoff: Landing's create form disappears and the
    // real fed2d login banner + room text land in the mudlet-web terminal —
    // proof the newly-created character is CREATED and LOGGED IN.
    await expect(page.getByText(/Fed2 Community Edition/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/You can see .*exit/i).first()).toBeVisible({ timeout: 15_000 });

    // f2ce-tools/Muxlet initializes on this fresh login too (the
    // char-burst-on-login path), same signal as stack-smoke.spec.ts.
    await expect(page.getByText(/Galaxy/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Groats:/i).first()).toBeVisible();

    const cmdInput = page.locator('textarea.command-input');
    await cmdInput.click();
    await cmdInput.fill('f2t on');
    await cmdInput.press('Enter');
    await expect(page.getByText(/f2ce-tools UI is on/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Muxlet isn't ready/i)).toHaveCount(0);

    expect(errors, `uncaught page errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('case 4: failure path — creating with an existing name is blocked', async ({ page }) => {
    await openCreateForm(page);

    await page.locator('#f2ce-create-name').fill('Test');
    await page.locator('#f2ce-create-password').fill('SuperSecret123');
    await page.locator('#f2ce-create-confirm-password').fill('SuperSecret123');
    await page.locator('#f2ce-create-email').fill('taken-name-check@example.com');
    await page.locator('#f2ce-create-race').fill('human');
    // Blur name last so the live CheckName fires against the final value.
    await page.locator('#f2ce-create-name').blur();

    await expect(page.locator('.f2ce-namecheck-taken')).toBeVisible({ timeout: 10_000 });

    // The submit button is deliberately NEVER disabled by client-side
    // validity (that was issue #7's root cause — a disabled button gives no
    // feedback at all). Clicking it here must run validation, show the
    // inline error, and NOT open a create session / navigate off the form.
    const submit = page.getByRole('button', { name: /^create character$/i });
    await expect(submit).toBeEnabled();
    await submit.click();
    // The "already taken" message shows on the live name-check line; the
    // field-level duplicate is intentionally suppressed (see the
    // duplicate-message fix). Submit stays blocked on the form regardless.
    await expect(page.locator('.f2ce-namecheck-taken')).toContainText(/already taken/i);
    await expect(page.locator('#f2ce-create-name')).toBeVisible();
    await expect(page.getByText(/Fed2 Community Edition/i)).toHaveCount(0);
  });

  test('case 6: blank required fields are blocked with inline messages, not a silent no-op (issues #3/#7)', async ({
    page,
  }) => {
    await openCreateForm(page);

    // Every create field starts blank except the 35/35/35 stat defaults and
    // the fixed gender choice — click Create immediately.
    const submit = page.getByRole('button', { name: /^create character$/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText(/character name must be 3 to 15 letters/i)).toBeVisible();
    await expect(page.getByText(/password must be at least 8 characters/i)).toBeVisible();
    await expect(page.getByText(/race must be 3 to 15 letters or numbers/i)).toBeVisible();
    // Still on the form, nothing was submitted to the engine.
    await expect(page.locator('#f2ce-create-name')).toBeVisible();
    await expect(page.getByText(/Fed2 Community Edition/i)).toHaveCount(0);
  });

  test('case 7: a too-short password is blocked with the engine-mirrored min-length message (issue #2)', async ({
    page,
  }) => {
    await openCreateForm(page);

    const fresh = uniqueName('Zsh');
    await page.locator('#f2ce-create-name').fill(fresh);
    await page.locator('#f2ce-create-password').fill('short');
    await page.locator('#f2ce-create-confirm-password').fill('short');
    await page.locator('#f2ce-create-race').fill('human');

    const submit = page.getByRole('button', { name: /^create character$/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText(/password must be at least 8 characters/i)).toBeVisible();
    await expect(page.getByText(/Fed2 Community Edition/i)).toHaveCount(0);
  });

  test('case 8: an out-of-range stat is blocked with a range message (issue #5)', async ({ page }) => {
    await openCreateForm(page);

    const fresh = uniqueName('Zst');
    await page.locator('#f2ce-create-name').fill(fresh);
    await page.locator('#f2ce-create-password').fill('SuperSecret123');
    await page.locator('#f2ce-create-confirm-password').fill('SuperSecret123');
    await page.locator('#f2ce-create-race').fill('human');
    await page.locator('#f2ce-create-strength').fill('99');

    const submit = page.getByRole('button', { name: /^create character$/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText(/strength must be between 20 and 70/i)).toBeVisible();
    await expect(page.getByText(/Fed2 Community Edition/i)).toHaveCount(0);
  });

  test('case 9: a malformed email is blocked, but a blank email is accepted (issue #8)', async ({ page }) => {
    test.setTimeout(60_000);
    await openCreateForm(page);

    const fresh = uniqueName('Zem');
    await page.locator('#f2ce-create-name').fill(fresh);
    await page.locator('#f2ce-create-password').fill('SuperSecret123');
    await page.locator('#f2ce-create-confirm-password').fill('SuperSecret123');
    await page.locator('#f2ce-create-race').fill('human');
    await page.locator('#f2ce-create-email').fill('not-an-email');

    const submit = page.getByRole('button', { name: /^create character$/i });
    await submit.click();
    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
    await expect(page.getByText(/Fed2 Community Edition/i)).toHaveCount(0);

    // Clear the email (now optional) and submit for real — the engine only
    // accepts the literal "skip" as no-email (Login::ValidateAndCreateAccount),
    // so this also proves submitCreate's blank->"skip" translation works
    // end-to-end, not just against a mocked session.
    await page.locator('#f2ce-create-email').fill('');
    await expect(page.locator('.f2ce-namecheck-available')).toBeVisible({ timeout: 10_000 });
    await submit.click();

    // A blank email now raises a confirmation first; continue without one.
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /continue without email/i }).click();

    await expect(page.getByText(/Fed2 Community Edition/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/You can see .*exit/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('case 5: regression — existing login still works, forgot still shows Landing confirmation', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/');
    await expect(page.locator('#f2ce-landing-name')).toBeVisible({ timeout: 15_000 });
    await page.fill('#f2ce-landing-name', 'Test');
    await page.fill('#f2ce-landing-password', 'anypassword');
    await page.getByRole('button', { name: /^log in$/i }).click();

    await expect(page.getByText(/Fed2 Community Edition/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/You can see .*exit/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Galaxy/i).first()).toBeVisible({ timeout: 30_000 });

    expect(errors, `uncaught page errors: ${errors.join('\n')}`).toHaveLength(0);

    // Forgot-password: a fresh page, since the first is now logged in.
    const forgotPage = await page.context().newPage();
    await forgotPage.goto('/');
    await expect(forgotPage.locator('#f2ce-landing-name')).toBeVisible({ timeout: 15_000 });
    await forgotPage.getByRole('button', { name: /forgot password/i }).click();
    await forgotPage.fill('#f2ce-forgot-pw-name', 'Test');
    await forgotPage.fill('#f2ce-forgot-pw-email', 'someone@example.com');
    await forgotPage.getByRole('button', { name: /email me a temporary password/i }).click();

    // Landing-local confirmation (role=status), never the ProfileSession
    // login-error modal — see Landing.tsx's class doc comment.
    await expect(forgotPage.locator('.f2ce-forgot-notice')).toBeVisible({ timeout: 15_000 });
    await expect(forgotPage.getByText(/login error/i)).toHaveCount(0);
    await forgotPage.close();
  });
});
