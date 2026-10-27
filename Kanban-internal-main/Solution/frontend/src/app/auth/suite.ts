// TT Suite (SUITE-CONTRACT §3.4, §4): the portal owns sign-in, sign-out, the person's apps, their
// name and their theme. Kanban runs under /kanban/; the portal's pages and API (/profile,
// /signout, /api/me) are at the site root, outside Kanban's /kanban/api/v1 client and router.
// Presentation only: the portal decides.
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { applyPreferences, type Mode, type Preset } from '../../theme/theme-switch';
import { usePreferences } from './useMe';

export const SUITE_APP = 'kanban';
export type SuiteApp = 'kanban' | 'lms' | 'expense' | 'ams';

export interface SuitePreferences {
  preset: Preset;
  mode: Mode;
}

/** Portal GET /api/me (camelCase). */
export interface PortalMe {
  id: string;
  email: string;
  name: string;
  isGlobalAdmin: boolean;
  photoUrl: string | null;
  access: Record<SuiteApp, string | null>;
  preferences: SuitePreferences;
  /** Unread messages in the suite inbox (the portal's /inbox). */
  unreadCount?: number;
}

export const PORTAL_ME_KEY = ['portal-me'] as const;
const XHR = { 'X-Requested-With': 'XHR' };
/** The portal's profile page: name, picture, theme (a whole-page link out of Kanban). */
export const PORTAL_PROFILE = '/profile';
/** The portal's sign-out page: it asks "this device or all devices". */
export const PORTAL_SIGN_OUT = '/signout';
/** The suite inbox (the portal's page), not Kanban's own card inbox. */
export const PORTAL_INBOX = '/inbox';

/** The suite's apps in dashboard order, with their public prefix (contract §1). */
export const SUITE_APPS: readonly { app: SuiteApp; href: string; label: string }[] = [
  { app: 'lms', href: '/lms/', label: 'suite.app.lms' },
  { app: 'expense', href: '/expense/', label: 'suite.app.expense' },
  { app: 'kanban', href: '/kanban/', label: 'suite.app.kanban' },
  { app: 'ams', href: '/ams/', label: 'suite.app.ams' },
];

function here(): string {
  return window.location.pathname + window.location.search;
}

/** 401: the portal's sign-in page, back to this exact page afterwards. */
export function toLogin(): void {
  window.location.assign('/login?returnTo=' + encodeURIComponent(here()));
}

/** 403 NO_APP_ACCESS: the portal dashboard says why. */
export function toDenied(): void {
  window.location.assign(`/?denied=${SUITE_APP}`);
}

/** Sign out is the portal's: a full page load of its sign-out page. */
export function portalSignOut(): void {
  window.location.assign(PORTAL_SIGN_OUT);
}

export async function fetchPortalMe(): Promise<PortalMe> {
  const res = await fetch('/api/me', { credentials: 'same-origin', headers: XHR });
  if (!res.ok) throw new Error(`portal /api/me ${String(res.status)}`);
  return (await res.json()) as PortalMe;
}

/** The person as the portal knows them; an error means "no portal" (Kanban run on its own). */
export function usePortalMe(enabled = true) {
  return useQuery({
    queryKey: PORTAL_ME_KEY,
    queryFn: fetchPortalMe,
    enabled,
    retry: false,
    staleTime: Infinity,
  });
}

/** Save the suite theme (every app shares it): PUT /api/me/preferences on the portal. */
export async function savePortalTheme(p: SuitePreferences): Promise<void> {
  const res = await fetch('/api/me/preferences', {
    method: 'PUT',
    headers: { ...XHR, 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(p),
  });
  if (!res.ok) throw new Error(`portal /api/me/preferences ${String(res.status)}`);
}

/**
 * The theme (preset + colour mode) the person sees. In the suite it is the portal's, shared by
 * every app and changed on the portal's profile page or by the top bar's light/dark toggle; without a portal (Kanban run on its
 * own, e.g. the e2e stack) Kanban's stored default is used (FR-170). Read only here.
 */
export function useThemePreferences(enabled = true) {
  const portal = usePortalMe(enabled);
  const local = usePreferences(enabled && portal.isError);
  const current: SuitePreferences | null = portal.data
    ? portal.data.preferences
    : local.data
      ? { preset: local.data.accent as Preset, mode: local.data.theme }
      : null;
  return { current, pending: portal.isPending || (portal.isError && local.isPending) };
}

/** Applies the stored theme once it is known (the AuthGate calls this on load). */
export function useApplyTheme(enabled: boolean) {
  const { current } = useThemePreferences(enabled);
  const preset = current?.preset;
  const mode = current?.mode;
  useEffect(() => {
    if (preset && mode) applyPreferences({ preset, mode });
  }, [preset, mode]);
}
