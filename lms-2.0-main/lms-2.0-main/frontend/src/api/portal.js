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

/** Saves the suite-wide theme preference (every app follows it). */
export const savePortalPreferences = (preferences) =>
  fetch('/api/me/preferences', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XHR' },
    body: JSON.stringify(preferences),
  });

/** Sign-out belongs to the portal: a full page load to /signout, where it asks "this
 * device or all devices". */
export const signOut = () => window.location.assign('/signout');
