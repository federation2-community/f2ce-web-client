import { defineConfig, devices } from '@playwright/test';

// No-engine smoke test: boots the built app via `vite preview` and checks
// the branded Landing renders. There is no local fed2d to connect to, so
// this config never dials a real engine — see e2e/MANUAL-CHECKLIST.md for
// the live connect/install path against the test server.
export default defineConfig({
  testDir: './e2e',
  // stack-smoke.spec.ts needs a live fed2d+proxy+dev-server trio (see
  // playwright.stack.config.ts / `npm run test:e2e:stack`) — exclude it here
  // so plain `npm run test:e2e` (used by deploy CI) doesn't try to run it
  // against this config's engine-less build/preview server.
  testIgnore: 'stack-smoke.spec.ts',
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:4173',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
