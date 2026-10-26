// Shared Playwright fixtures (plan B01 task 14):
//  - every test fails on any CSP violation (securitypolicyviolation event or CSP console error);
//  - `axe(name)` writes an axe-core report to test-results/axe/<name>-<viewport>.json (non-gating).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
export const AXE_DIR = path.resolve(here, '../../test-results/axe');
export const SHOT_DIR = path.resolve(here, '../../test-results/screenshots');

declare global {
  interface Window {
    __cspViolations: string[];
    appTheme: { applyPreset: (p: string) => string; applyMode: (m: string) => string };
  }
}

/** desktop-chromium → "desktop"; mobile-webkit → "mobile-webkit" (smoke engines keep their name). */
export function viewportName(projectName: string): string {
  const [vp, engine] = projectName.split('-');
  return engine === 'chromium' ? (vp as string) : projectName;
}

export interface Fixtures {
  cspViolations: string[];
  axe: (name: string) => Promise<{ serious: number; critical: number }>;
  /** Full-page screenshot → test-results/screenshots/<name>-<viewport>.png (evidence per viewport). */
  shot: (name: string) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  cspViolations: [
    async ({ page }, use) => {
      const violations: string[] = [];
      await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__cspViolations.push(`${e.violatedDirective}: ${e.blockedURI}`);
        });
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error' && /Content[ -]Security[ -]Policy/i.test(msg.text()))
          violations.push(`console: ${msg.text()}`);
      });
      await use(violations);
      const inPage = await page
        .evaluate(() => window.__cspViolations ?? [])
        .catch(() => [] as string[]);
      expect([...violations, ...inPage], 'no CSP violations').toEqual([]);
    },
    { auto: true },
  ],
  shot: async ({ page, browserName }, use, testInfo) => {
    await use(async (name: string) => {
      // Playwright's WebKit screenshot path injects an inline <style> element (isolated in
      // Chromium/Firefox), which the page's strict CSP rejects and the fixture above would
      // count as a violation of the app. Evidence screenshots come from the three gating
      // Chromium viewports; the WebKit smoke run keeps the CSP assertion and skips the file.
      if (browserName === 'webkit') return;
      mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(SHOT_DIR, `${name}-${viewportName(testInfo.project.name)}.png`),
        fullPage: true,
        caret: 'initial',
      });
    });
  },
  axe: async ({ page }, use, testInfo) => {
    await use(async (name: string) => {
      // preload:false — axe would otherwise fetch() the cross-origin Google Fonts stylesheet to
      // read its CSSOM, which the strict CSP (no connect-src exception) rightly blocks.
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .options({ preload: false })
        .analyze();
      mkdirSync(AXE_DIR, { recursive: true });
      const file = path.join(AXE_DIR, `${name}-${viewportName(testInfo.project.name)}.json`);
      writeFileSync(file, JSON.stringify(results, null, 2));
      const count = (impact: string) =>
        results.violations.filter((v) => v.impact === impact).length;
      return { serious: count('serious'), critical: count('critical') };
    });
  },
});

export { expect };
export type { Page };
