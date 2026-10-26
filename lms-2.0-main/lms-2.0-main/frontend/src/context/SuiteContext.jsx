import { createContext, useContext, useEffect, useState } from 'react';
import { getPortalMe } from '../api/portal';

// The signed-in person as the TT Suite portal sees them (GET /api/me): which suite apps
// they can open (app switcher) and their suite-wide theme preferences. Fetched once.
// A failure here never blocks the LMS itself — the LMS API's own 401/403 handling
// (api/client.js) decides whether the person may be here.
const SuiteContext = createContext({ me: null, loading: true });

export function SuiteProvider({ children }) {
  const [state, setState] = useState({ me: null, loading: true });

  useEffect(() => {
    let alive = true;
    getPortalMe()
      .then((me) => alive && setState({ me, loading: false }))
      .catch(() => alive && setState({ me: null, loading: false }));
    return () => {
      alive = false;
    };
  }, []);

  return <SuiteContext.Provider value={state}>{children}</SuiteContext.Provider>;
}

export const useSuite = () => useContext(SuiteContext);
