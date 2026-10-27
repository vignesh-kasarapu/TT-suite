import { createContext, useContext, useEffect, useState } from 'react';
import { getPortalMe } from '../api/portal';

// The signed-in person as the TT Suite portal sees them (GET /api/me): which suite apps
// they can open (app switcher), their profile photo and their suite-wide theme preferences.
// Fetched on load and again whenever the tab becomes visible (e.g. after uploading a new
// photo on the portal's Profile page in another tab).
// A failure here never blocks the LMS itself — the LMS API's own 401/403 handling
// (api/client.js) decides whether the person may be here.
const SuiteContext = createContext({ me: null, loading: true });

export function SuiteProvider({ children }) {
  const [state, setState] = useState({ me: null, loading: true });

  useEffect(() => {
    let alive = true;
    const load = (initial) =>
      getPortalMe()
        // `loadedAt` lets the top-bar photo URL change on each refresh: the portal serves the
        // photo at a fixed URL, which an <img> already on the page would not re-request.
        .then((me) => alive && setState({ me, loading: false, loadedAt: Date.now() }))
        // A failed refresh keeps what we already have; only the first load clears it.
        .catch(() => alive && initial && setState({ me: null, loading: false }));
    load(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return <SuiteContext.Provider value={state}>{children}</SuiteContext.Provider>;
}

export const useSuite = () => useContext(SuiteContext);
