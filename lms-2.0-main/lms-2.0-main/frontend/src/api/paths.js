// TT Suite paths. The LMS SPA is served by the portal gateway under /lms/ (Vite `base`),
// its API under /lms/api, and the portal's own API (sign-in, /api/me, preferences) at /api.

/** '/lms/' in the suite build — every LMS URL is built from it, never hardcoded. */
export const BASE_URL = import.meta.env.BASE_URL;
/** React Router basename: '/lms' (no trailing slash). */
export const ROUTER_BASENAME = BASE_URL.replace(/\/$/, '');
/** The LMS backend through the gateway: '/lms/api'. */
export const API_BASE = `${BASE_URL}api`;
/** A file in public/ (e.g. 'brand/tektalis.png'). */
export const asset = (path) => `${BASE_URL}${path.replace(/^\//, '')}`;

/** The current location, prefix included, for the portal's ?returnTo= (the LMS's own
 * /login page is never a destination worth returning to). */
export const currentPath = () =>
  window.location.pathname.startsWith(`${BASE_URL}login`) ? BASE_URL : window.location.pathname + window.location.search;

/** Portal sign-in, coming back here afterwards (suite contract §3.4). */
export const portalLoginUrl = (returnTo = currentPath()) => `/login?returnTo=${encodeURIComponent(returnTo)}`;
