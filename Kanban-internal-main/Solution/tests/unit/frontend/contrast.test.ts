// B01 — token-level contrast gate (TC-024, NFR-024): parses tokens.css, checks every pair for
// 3 presets × 2 modes against design-tokens.json minimums (port of house-standard
// scripts/contrast-check.py), and the 16 px base size.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_CSS = path.resolve(here, '../../../frontend/src/styles/tokens.css');
const DESIGN_TOKENS = path.resolve(here, 'design-tokens.json');

interface DesignTokens {
  default: string;
  shared: {
    fontSizeBase: string;
    contrastMinimums: { bodyText: number; largeTextAndUi: number; nonTextUi: number };
  };
  presets: Record<
    string,
    {
      fontSize: Record<string, string>;
      color: { light: Record<string, string>; dark: Record<string, string> };
    }
  >;
}

function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255) as [
    number,
    number,
    number,
  ];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Every preset block of tokens.css → { light: {token: hex}, dark: {token: hex} }. */
export function parseTokensCss(
  css: string,
): Record<string, { light: Record<string, string>; dark: Record<string, string> }> {
  const out: Record<string, { light: Record<string, string>; dark: Record<string, string> }> = {};
  const block = /\[data-preset="(\w+)"\]\s*\{([\s\S]*?)\n\}/g;
  for (const m of css.matchAll(block)) {
    const [, name, body] = m as unknown as [string, string, string];
    const light: Record<string, string> = {};
    const dark: Record<string, string> = {};
    for (const c of body.matchAll(
      /--color-([\w-]+):\s*light-dark\((#[0-9A-Fa-f]{6}),\s*(#[0-9A-Fa-f]{6})\)/g,
    )) {
      light[c[1] as string] = c[2] as string;
      dark[c[1] as string] = c[3] as string;
    }
    out[name] = { light, dark };
  }
  return out;
}

describe('TC-024 B01-10 contrast check 3 presets × 2 modes', () => {
  const design = JSON.parse(readFileSync(DESIGN_TOKENS, 'utf8')) as DesignTokens;
  const css = readFileSync(TOKENS_CSS, 'utf8');
  const presets = parseTokensCss(css);
  const { bodyText, largeTextAndUi, nonTextUi } = design.shared.contrastMinimums;

  // (foreground, background, minimum): body text 7, large text / UI 4.5, non-text UI 3 (theme.md §5).
  const PAIRS: [string, string, number][] = [
    ['text', 'bg', bodyText],
    ['text', 'surface', bodyText],
    ['text-muted', 'bg', bodyText],
    ['text-muted', 'surface', bodyText],
    ['accent-text', 'bg', bodyText],
    ['accent-text', 'surface', bodyText],
    ['accent-contrast', 'accent', largeTextAndUi],
    ['danger-contrast', 'danger', largeTextAndUi],
    ['accent', 'bg', nonTextUi],
    ['danger-text', 'bg', bodyText],
    ['danger-text', 'surface', bodyText],
    ['success', 'bg', largeTextAndUi],
    ['warning', 'bg', largeTextAndUi],
    ['danger', 'bg', largeTextAndUi],
    ['danger', 'surface', largeTextAndUi],
    ['text', 'danger-bg', bodyText],
    ['text', 'success-bg', bodyText],
    ['text', 'warning-bg', bodyText],
    ['danger-text', 'danger-bg', largeTextAndUi],
    ['success', 'success-bg', largeTextAndUi],
    ['warning', 'warning-bg', largeTextAndUi],
    ...([1, 2, 3, 4] as const).flatMap((i): [string, string, number][] => [
      ['text', `tint-${i}`, bodyText],
      ['text-muted', `tint-${i}`, bodyText],
      ['accent-text', `tint-${i}`, largeTextAndUi],
    ]),
  ];

  it('tokens.css carries exactly the three presets of design-tokens.json, and linen is the default', () => {
    expect(Object.keys(presets).sort()).toEqual(['graphite', 'harbour', 'linen']);
    expect(Object.keys(design.presets).sort()).toEqual(['graphite', 'harbour', 'linen']);
    expect(design.default).toBe('linen');
    expect(css).toMatch(/:root,\s*:root\[data-preset="linen"\]/);
  });

  it('every colour token in tokens.css equals design-tokens.json (source of truth)', () => {
    for (const [name, modes] of Object.entries(presets)) {
      const src = design.presets[name];
      expect(src, name).toBeDefined();
      expect(modes.light).toEqual(src?.color.light);
      expect(modes.dark).toEqual(src?.color.dark);
    }
  });

  it('0 failures: body ≥ 7:1, large text/UI ≥ 4.5:1, non-text UI ≥ 3:1 for linen/harbour/graphite × light/dark', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const [name, modes] of Object.entries(presets)) {
      for (const mode of ['light', 'dark'] as const) {
        const t = modes[mode];
        for (const [fg, bg, min] of PAIRS) {
          const f = t[fg];
          const b = t[bg];
          if (!f || !b) {
            failures.push(`MISSING ${name}/${mode}: --color-${fg} or --color-${bg}`);
            continue;
          }
          checked++;
          const ratio = contrastRatio(f, b);
          if (ratio < min)
            failures.push(`FAIL ${name}/${mode}: ${fg} on ${bg} = ${ratio.toFixed(2)} < ${min}`);
        }
      }
    }
    expect(checked).toBe(3 * 2 * PAIRS.length);
    expect(failures).toEqual([]);
  });

  it('base font size token is 16px in every preset', () => {
    expect(design.shared.fontSizeBase).toBe('16px');
    for (const [name, p] of Object.entries(design.presets))
      expect(p.fontSize['size-2'], name).toBe('16px');
    for (const m of css.matchAll(/--font-size-2:\s*([\d.]+px)/g)) expect(m[1]).toBe('16px');
    expect(css.match(/--font-size-2:/g)?.length).toBe(3);
  });
});
