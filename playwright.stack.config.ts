import { defineConfig, devices } from '@playwright/test';

// Live full-stack smoke test: targets the REAL local dev-stack.sh trio
// (fed2d + f2ce-proxy + vite dev server), not a build/preview server. Unlike
// playwright.config.ts's no-engine build smoke test, this one dials out and
// logs in for real, so it requires `scripts/dev-stack.sh` to already be
// running (there is deliberately no `webServer` block here — this config
// does not manage the stack's lifecycle).
//
// Run: npm run test:e2e:stack   (after `scripts/dev-stack.sh` reports "stack up")
// Override the target with STACK_URL if dev-stack.sh picked a non-default
// vite port (it prints the actual URL to use).
export default defineConfig({
  testDir: './e2e',
  testMatch: 'stack-smoke.spec.ts',
  timeout: 60_000,
  use: {
    baseURL: process.env.STACK_URL ?? 'http://localhost:5173',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
