import axios from 'axios';

// The TT Suite portal's own API (suite contract §4) — same origin, path /api (not the
// LMS's /lms/api). JSON is camelCase. Only the suite-level bits the LMS shell needs.
const portal = axios.create({ baseURL: '/api', withCredentials: true });

portal.interceptors.request.use((config) => {
  if ((config.method || 'get').toLowerCase() !== 'get') {
    config.headers = { ...config.headers, 'X-Requested-With': 'XHR' };
  }
  return config;
});

/** {id, email, name, isGlobalAdmin, photoUrl, access: {kanban, lms, expense}, preferences: {preset, mode}} */
export const getPortalMe = () => portal.get('/me').then((res) => res.data);

export const savePortalPreferences = (preferences) => portal.put('/me/preferences', preferences).then((res) => res.data);

/** Ends the suite session (every app), then the caller sends the browser to /login. */
export const portalLogout = () => portal.post('/auth/logout');
