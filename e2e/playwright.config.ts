import { defineConfig, devices } from '@playwright/test';

// The suite under test is started by e2e/run.mjs (or already running): one portal on E2E_BASE_URL
// in front of Kanban, LMS and EMS, with dev sign-in and the stub mailer.
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // One suite and one database behind every test: run them one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /dashboard\.spec\.ts/ },
  ],
});
