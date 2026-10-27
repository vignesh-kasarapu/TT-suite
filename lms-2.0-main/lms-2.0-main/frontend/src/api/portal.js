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

/** {id, email, name, employeeCode, isGlobalAdmin, photoUrl, access: {kanban, lms, expense}, preferences: {preset, mode}} */
export const getPortalMe = () => portal.get('/me').then((res) => res.data);

/** Saves the suite-wide theme preference (every app follows it). */
export const savePortalPreferences = (preferences) =>
  fetch('/api/me/preferences', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XHR' },
    body: JSON.stringify(preferences),
  });

async function readError(res, fallback) {
  try {
    const body = await res.json();
    return body?.error?.message || body?.message || body?.error || fallback;
  } catch {
    return fallback;
  }
}

/** The signed-in user's sessions: [{ current, userAgent, createdAt, lastSeenAt }]. */
export async function getMySessions() {
  const res = await fetch('/api/me/sessions', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(await readError(res, `Could not load sessions (${res.status})`));
  const body = await res.json();
  return Array.isArray(body?.items) ? body.items : [];
}

/** Ends this session (everywhere = false) or every session of the user (everywhere = true).
 * Clears this tab's session storage and goes to the portal's sign-in page on success. */
export async function signOut({ everywhere = false } = {}) {
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XHR' },
    body: JSON.stringify({ everywhere: Boolean(everywhere) }),
  });
  if (!res.ok) throw new Error(await readError(res, `Sign out failed (${res.status})`));
  sessionStorage.clear();
  window.location.assign('/login');
}
