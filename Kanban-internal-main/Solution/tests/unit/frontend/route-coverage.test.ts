// D-087 (2): every route in the app's route table is opened by at least one e2e spec. The admin
// Users tab once crashed in the trial because no spec ever visited it. A route counts as visited
// when some spec names a matching URL literal ('/org', `/teams/${id}/cards/${key}`, ...).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../frontend/src/app/routes';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPECS = path.resolve(here, '../../e2e/specs');

type Route = {
  path?: string | undefined;
  index?: boolean | undefined;
  children?: Route[] | undefined;
};

function patterns(list: Route[], base = ''): string[] {
  return list.flatMap((r) => {
    const full = r.path?.startsWith('/') ? r.path : `${base.replace(/\/$/, '')}/${r.path ?? ''}`;
    const own = r.path || r.index ? [full === '/' ? '/' : full.replace(/\/$/, '')] : [];
    return [...own, ...patterns(r.children ?? [], r.path ? full : base)];
  });
}

/** App URLs named in the specs; `${...}` stands for a path parameter, the query is dropped. */
function specUrls(): string[] {
  const urls: string[] = [];
  for (const f of readdirSync(SPECS).filter((n) => n.endsWith('.spec.ts'))) {
    const src = readFileSync(path.join(SPECS, f), 'utf8');
    for (const m of src.matchAll(/(['`])(\/[^'`\s]*)\1/g)) {
      const url = m[2]!.replace(/\$\{[^}]*\}/g, 'x').split('?')[0]!;
      if (!url.startsWith('/api/')) urls.push(url);
    }
  }
  return urls;
}

const matches = (pattern: string, url: string) =>
  new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+')}/?$`).test(url);

describe('route coverage (D-087)', () => {
  it('every route is opened by some e2e spec', () => {
    const urls = specUrls();
    const all = [...new Set(patterns(routes))].filter((p) => !p.endsWith('*'));
    expect(all.length).toBeGreaterThan(20); // the walk found the table
    expect(all.filter((p) => !urls.some((u) => matches(p, u)))).toEqual([]);
  });
});
