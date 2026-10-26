import { defineConfig, devices } from '@playwright/test';

// tech-stack §5: three Chromium viewports gate; WebKit/Firefox/mobile-WebKit run the @smoke subset.
// The app under test is the Compose `app` image (scripts/e2e.mjs brings it up) or any server
// at E2E_BASE_URL. Browsers: `npm run playwright:install` (they go to %LOCALAPPDATA%\ms-playwright).
export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  // One worker: B02 specs share the app's fake clock (session-expiry tests move it) and the
  // fixture people (lockout, password changes), so specs must not interleave.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: './test-results/results.json' }],
    ['html', { outputFolder: './playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:8080',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'tablet-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } },
    },
    {
      // D-087: a short, wide screen - long pages overflow it, where the tab strip once collapsed.
      // Only the layout sweep runs here; it covers every route and dialog.
      name: 'short-chromium',
      testMatch: /cr18\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 600 } },
    },
    {
      name: 'desktop-webkit',
      grep: /@smoke/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'desktop-firefox',
      grep: /@smoke/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile-webkit',
      grep: /@smoke/,
      use: { ...devices['iPhone 13'] },
    },
  ],
});
