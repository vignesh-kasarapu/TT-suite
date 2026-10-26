// TT Suite (SUITE-CONTRACT §3.4, §4): the portal owns sign-in, sign-out, the person's apps and
// their theme. Kanban runs under /kanban/; the portal API (/api/me, /api/auth/logout) is at the
// site root, outside Kanban's /kanban/api/v1 client. Presentation only: the portal decides.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, unwrap } from '../../api/client';
import { applyPreferences, type Mode, type Preset } from '../../theme/theme-switch';
import { PREFS_KEY, usePreferences } from './useMe';

export const SUITE_APP = 'kanban';
export type SuiteApp = 'kanban' | 'lms' | 'expense';

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
}

export const PORTAL_ME_KEY = ['portal-me'] as const;
const XHR = { 'X-Requested-With': 'XHR' };

/** The suite's apps in dashboard order, with their public prefix (contract §1). */
export const SUITE_APPS: readonly { app: SuiteApp; href: string; label: string }[] = [
  { app: 'lms', href: '/lms/', label: 'suite.app.lms' },
  { app: 'expense', href: '/expense/', label: 'suite.app.expense' },
  { app: 'kanban', href: '/kanban/', label: 'suite.app.kanban' },
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

/** Sign out of the whole suite (the portal clears the session), then its sign-in page. */
export async function portalSignOut(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: XHR,
    credentials: 'same-origin',
  }).catch(() => undefined);
  window.location.assign('/login');
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

async function savePortalPreferences(p: SuitePreferences): Promise<SuitePreferences> {
  const res = await fetch('/api/me/preferences', {
    method: 'PUT',
    headers: { ...XHR, 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(p),
  });
  if (!res.ok) throw { status: res.status, code: 'HTTP_' + String(res.status) };
  return (await res.json()) as SuitePreferences;
}

/**
 * The theme (preset + colour mode) the person sees, and how to change it. In the suite it is
 * the portal's (shared by every app, `PUT /api/me/preferences`); without a portal (Kanban run on
 * its own, e.g. the e2e stack) Kanban's own stored preference is used as before (FR-170).
 */
export function useThemePreferences(enabled = true) {
  const queryClient = useQueryClient();
  const portal = usePortalMe(enabled);
  const local = usePreferences(enabled && portal.isError);
  const current: SuitePreferences | null = portal.data
    ? portal.data.preferences
    : local.data
      ? { preset: local.data.accent as Preset, mode: local.data.theme }
      : null;
  const save = useMutation({
    mutationFn: async (next: SuitePreferences) => {
      if (portal.data) return savePortalPreferences(next);
      const data = unwrap(
        await api.PATCH('/me/preferences', { body: { accent: next.preset, theme: next.mode } }),
      );
      queryClient.setQueryData(PREFS_KEY, data);
      return next;
    },
  });
  function set(patch: Partial<SuitePreferences>) {
    if (!current) return;
    const next = { ...current, ...patch };
    applyPreferences(next); // immediate (D-112); the server keeps it for the next device
    if (portal.data) queryClient.setQueryData(PORTAL_ME_KEY, { ...portal.data, preferences: next });
    else if (local.data)
      queryClient.setQueryData(PREFS_KEY, { ...local.data, accent: next.preset, theme: next.mode });
    save.mutate(next);
  }
  return {
    current,
    pending: portal.isPending || (portal.isError && local.isPending),
    set,
    error: save.error,
  };
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
