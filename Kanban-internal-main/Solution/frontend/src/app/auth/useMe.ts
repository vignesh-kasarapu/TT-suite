// getMe + getMyPreferences as React Query hooks. The context is refetched on every route
// change so the nav and gates always reflect what the server decided.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation, useOutletContext } from 'react-router';
import { api, asProblem, unwrap } from '../../api/client';
import type { components } from '../../api/schema';

export type Me = components['schemas']['Me'];
export type Preferences = components['schemas']['Preferences'];

export const ME_KEY = ['me'] as const;
export const PREFS_KEY = ['preferences'] as const;

export class ApiStatusError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function fetchMe(): Promise<Me> {
  const res = await api.GET('/me');
  if (res.data) return res.data;
  // 401 = no suite session; 403 NO_APP_ACCESS = signed in, but not to Kanban (contract §3.1).
  throw new ApiStatusError(res.response.status, asProblem(res.error)?.code ?? 'UNAUTHENTICATED');
}

/** The context the AuthGate/Shell passed down through the router outlet. */

export function useContextData(): Me {
  return useOutletContext<Me>();
}

export function useMe() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false, staleTime: 0 });
  // Every navigation re-validates the session and role.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
  }, [location.pathname, queryClient]);
  return q;
}

export async function fetchPreferences(): Promise<Preferences> {
  return unwrap(await api.GET('/me/preferences'));
}

/** Kanban's own stored preferences (defaults, inbox window, mail opt-in), once per session.
 *  The theme is the suite's: see `useThemePreferences` in ./suite. */
export function usePreferences(enabled: boolean) {
  return useQuery({
    queryKey: PREFS_KEY,
    queryFn: fetchPreferences,
    enabled,
    retry: false,
    staleTime: Infinity,
  });
}
