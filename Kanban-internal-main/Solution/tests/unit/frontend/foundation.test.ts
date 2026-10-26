// B01 — frontend foundation: t(), theme cycling, API client headers, display formatters (TC-037),
// module-CSS colour grep + jsx-no-literals lint rule (TC-035).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { t, hasMessage } from '../../../frontend/src/i18n/t';
import { MODES, PRESETS, nextMode, nextPreset } from '../../../frontend/src/theme/theme-switch';
import { createApi, problemMessage } from '../../../frontend/src/api/client';
import {
  formatDate,
  formatDateTime,
  formatDays,
  formatTime,
} from '../../../frontend/src/styles/format';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, '../../../frontend');

describe('i18n t()', () => {
  it('substitutes params and returns a visible marker for a missing key', () => {
    expect(t('notFound.body', { path: '/x' })).toContain('/x');
    expect(t('nav.board')).toBe('My board');
    expect(t('does.not.exist')).toBe('[does.not.exist]');
    expect(hasMessage('nav.preferences')).toBe(true);
    expect(hasMessage('nope')).toBe(false);
  });
});

describe('theme cycling (D-112)', () => {
  it('nextPreset cycles Linen → Harbour → Graphite → Linen; nextMode System → Light → Dark → System', () => {
    expect(PRESETS).toEqual(['linen', 'harbour', 'graphite']);
    expect(MODES).toEqual(['system', 'light', 'dark']);
    expect(nextPreset('linen')).toBe('harbour');
    expect(nextPreset('harbour')).toBe('graphite');
    expect(nextPreset('graphite')).toBe('linen');
    expect(nextMode('system')).toBe('light');
    expect(nextMode('light')).toBe('dark');
    expect(nextMode('dark')).toBe('system');
  });
});

describe('API client', () => {
  it('adds X-Requested-With: XHR to every call', async () => {
    const seen: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push(new Request(input, init));
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = createApi(fetchImpl, 'http://app.test/api/v1'); // absolute: Node's Request needs a full URL
    await api.GET('/health');
    await api.POST('/auth/sign-out');
    expect(seen).toHaveLength(2);
    const [get, post] = seen as [Request, Request];
    expect(get.headers.get('x-requested-with')).toBe('XHR');
    expect(post.headers.get('x-requested-with')).toBe('XHR');
    // A body-less POST carries no content-type (an empty application/json body is a 400).
    expect(post.headers.get('content-type')).toBeNull();
    await api.PATCH('/me/preferences', { body: { theme: 'dark' } });
    expect(seen[2]?.headers.get('content-type')).toBe('application/json');
  });

  it('maps a problem code to an externalised message and unknown codes to the generic line', () => {
    expect(problemMessage({ status: 404, code: 'NOT_FOUND' })).toBe(t('problem.NOT_FOUND'));
    expect(problemMessage({ status: 418, code: 'TEAPOT' })).toBe(t('problem.unknown'));
    expect(problemMessage(undefined)).toBe(t('problem.NETWORK'));
  });
});

describe('TC-037 display formatters (NFR-037)', () => {
  it('date 2026-08-15 → "15 Aug 2026"; 9 days → "9.0"; 2026-06-15T04:30:00Z in Asia/Kolkata → "10:00 IST"', () => {
    expect(formatDate('2026-08-15')).toBe('15 Aug 2026');
    expect(formatDays(9)).toBe('9.0');
    expect(formatDays('1.5')).toBe('1.5');
    expect(formatTime('2026-06-15T04:30:00Z', 'Asia/Kolkata')).toBe('10:00 IST');
    expect(formatDateTime('2026-06-15T04:30:00Z', 'Asia/Kolkata')).toBe('15 Jun 2026, 10:00 IST');
  });
});

describe('TC-035 no raw colours in module CSS; no literal UI strings', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  }
  it('grep of src/**/*.module.css for hex or rgb()/rgba() returns zero matches', () => {
    const files = walk(path.join(FRONTEND, 'src')).filter((f) => f.endsWith('.module.css'));
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g))
        hits.push(`${path.relative(FRONTEND, f)}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });
  it('react/jsx-no-literals is an error in the frontend ESLint config (the lint step enforces it)', () => {
    const cfg = readFileSync(path.join(FRONTEND, 'eslint.config.js'), 'utf8');
    expect(cfg).toMatch(/'react\/jsx-no-literals':\s*'error'/);
  });
});
