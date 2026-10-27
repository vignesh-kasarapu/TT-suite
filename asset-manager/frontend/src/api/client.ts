import axios, { AxiosError } from 'axios';
import type { ApiErrorResponse } from '../types';

// TT Suite: this UI is served under /ams/ by the portal gateway, which forwards /ams/api/* to the
// AMS backend. Sign-in is the portal's session cookie (same origin, sent automatically): no token
// is kept in the browser. Writes carry X-Requested-With, which the suite's CSRF check requires.
export const USER_STORAGE_KEY = 'ams_user';
export const SESSION_EXPIRED_EVENT = 'ams:session-expired';
export const API_BASE = `${import.meta.env.BASE_URL}api/v1`;

export const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XHR',
  },
});

let sessionExpiredNotified = false;

export function resetSessionExpiredFlag(): void {
  sessionExpiredNotified = false;
}

/** The suite sign-in page; it brings the person back to this page afterwards. */
export function goToSuiteLogin(): void {
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login?returnTo=${encodeURIComponent(here)}`);
}

/** Local sign-out cleanup: forget the cached profile. The portal's POST /api/auth/logout
 *  (sent by the header's sign-out card) ends the session itself. */
export function clearLocalSession(): void {
  try {
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing cached to forget.
  }
}

export function notifySessionExpired(): void {
  if (sessionExpiredNotified || typeof window === 'undefined') {
    return;
  }
  sessionExpiredNotified = true;
  localStorage.removeItem(USER_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorResponse>) => {
    const status = error.response?.status;
    if (status === 401) {
      // No (or an expired) suite session: the modal explains, then goes to the suite sign-in.
      notifySessionExpired();
    } else if (status === 403 && error.response?.data?.code === 'NO_APP_ACCESS') {
      // Signed in, but no Asset Management role: the dashboard says so and offers "Request access".
      window.location.assign('/?denied=ams');
    }
    return Promise.reject(error);
  },
);

export function extractErrorMessage(error: unknown, fallback = 'An unexpected error occurred'): string {
  if (axios.isAxiosError(error)) {
    const axiosErr = error as AxiosError<ApiErrorResponse | { detail?: string }>;
    const data = axiosErr.response?.data;
    if (data && typeof data === 'object') {
      if ('message' in data && typeof data.message === 'string') {
        return data.message;
      }
      if ('detail' in data && typeof data.detail === 'string') {
        return data.detail;
      }
    }
    if (axiosErr.message) {
      return axiosErr.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}
