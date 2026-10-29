import { keepPreviousData, QueryClient, useQuery, type QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../models/http";

/** One cache for the whole app (main.tsx). Data is always refetched when a page opens (staleTime 0), but the
 * last copy shows at once while that happens, so going back to a page never flashes a skeleton. No retries
 * and no refetch on window focus: errors show straight away, and a form being edited is never reloaded under the person. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 0, retry: false, refetchOnWindowFocus: false } },
});

/** Load data under a cache key (and again when the key changes or reload() is called).
 * The key names what is loaded plus every value the loader uses, e.g. ["claims", "mine", { q }].
 * `loading` is true only while there is nothing to show yet; a background refresh keeps the current data on screen. */
export function useResource<T>(key: QueryKey, load: () => Promise<T>) {
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      try {
        return await load();
      } catch (e) {
        throw e instanceof ApiError ? e : new ApiError(String(e), 0);
      }
    },
    // A new key (a search, a filter) keeps the previous results up until the new ones arrive
    placeholderData: keepPreviousData,
  });
  const { refetch } = query;
  const reload = useCallback(async () => { await refetch(); }, [refetch]);
  return { data: query.data ?? null, error: (query.error as ApiError | null) ?? null, loading: query.isPending, reload };
}

/** Run a user action with a busy flag and a readable error. Returns the result, or undefined on failure. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(String(e), 0));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, setError, run };
}

/** theme.md §4 breakpoints: mobile < 640, tablet 640-1023, desktop >= 1024. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

export const BP = { tablet: "(min-width: 640px)", desktop: "(min-width: 1024px)" };
