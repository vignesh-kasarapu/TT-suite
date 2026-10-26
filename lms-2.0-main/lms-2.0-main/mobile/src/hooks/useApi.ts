import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { ApiError } from '../api/client';

/** Fetch-on-focus (not just on-mount, so switching back to a tab picks up
 * changes made elsewhere — e.g. approving a request then returning to the
 * dashboard) with loading/error/refresh state, shared by every screen. */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await fetcher());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Pull to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  return { data, loading, refreshing, error, refresh: () => load(true), reload: () => load(false) };
}
