// TC-117 B02-4 — unsent-form preservation helper (FR-002, C-21) and the nav set per
// capacities (§4.2) — presentation helpers, no rules.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSignedIn,
  markSignedIn,
  peekReturnTo,
  preserve,
  safeReturnTo,
  take,
  wasSignedIn,
} from '../../../frontend/src/app/auth/session';
import { barOrder, moreOrder, navFor } from '../../../frontend/src/app/nav-items';

/** Minimal sessionStorage for the node environment. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('TC-117 B02-4 unsent-form preservation helper', () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { sessionStorage: fakeStorage() };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('store form + return URL → simulate 401 → re-auth → values restored exactly; entry removed after restore', () => {
    const form = {
      leaveTypeId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      startDate: '2026-08-10',
      reason: 'Family event',
    };
    preserve({ returnTo: '/apply?draft=1', form });
    // 401 → the app marks the tab as "was signed in" → expired page → sign-in again
    markSignedIn();
    expect(wasSignedIn()).toBe(true);
    clearSignedIn();
    expect(wasSignedIn()).toBe(false);
    expect(peekReturnTo()).toBe('/apply?draft=1');
    const restored = take();
    expect(restored).toEqual({ returnTo: '/apply?draft=1', form });
    expect(restored?.form).toStrictEqual(form);
    expect(take()).toBeNull();
    expect(peekReturnTo()).toBeNull();
  });

  it('only same-origin paths are used as return targets', () => {
    expect(safeReturnTo('/requests')).toBe('/requests');
    expect(safeReturnTo('https://evil.example/x')).toBe('/');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
  });
});

describe('nav per role (rendered from getMe)', () => {
  const labels = (role: 'member' | 'admin', isLead = false) =>
    navFor(role, isLead).map((i) => i.label);
  const HEAD = ['nav.board', 'nav.teams', 'nav.programs', 'nav.reports', 'nav.time'];
  const TAIL = ['nav.search', 'nav.preferences'];
  it('member: boards, programs, reports, My time, search, preferences; admin and lead add Team time and Administration (FR-071, D-116)', () => {
    expect(labels('member')).toEqual([...HEAD, ...TAIL]);
    const manage = [...HEAD, 'nav.teamTime', ...TAIL, 'nav.administration'];
    expect(labels('admin')).toEqual(manage);
    expect(labels('member', true)).toEqual(manage);
  });
  it('mobile bar holds My board, Teams and My time (the Inbox is the top-bar bell, D-122); More holds the rest', () => {
    expect(barOrder(navFor('admin')).map((i) => i.label)).toEqual([
      'nav.board',
      'nav.teams',
      'nav.time',
    ]);
    // D-145: Unassigned is no longer in the nav (the page stays, for legacy team-less cards).
    expect(moreOrder(navFor('admin')).map((i) => i.label)).toEqual([
      'nav.programs',
      'nav.reports',
      'nav.teamTime',
      'nav.search',
      'nav.preferences',
      'nav.administration',
    ]);
  });
});
