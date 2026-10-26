import { defineConfig, devices } from '@playwright/test';

// The team walkthrough (walkthrough/team-walkthrough.spec.ts): on request only, never in ci:local.
// It needs an EMPTY database with the boot admin anita.rao@example.test and a dev-mode app at
// E2E_BASE_URL (default: the Vite dev server). Steps run in order and share what they create.
export default defineConfig({
  testDir: './walkthrough',
  outputDir: './test-results/walkthrough',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: './playwright-report/walkthrough', open: 'never' }],
  ],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
