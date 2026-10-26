import axios from 'axios';
import { API_BASE, portalLoginUrl } from './paths';

// Every LMS backend call in this app goes through this single instance.
// Components never call axios/fetch directly — see the sibling files in this folder.
// TT Suite: the session is the portal's cookie (tt_session), sent automatically.
const client = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// State-changing calls carry the header the suite backends require (CSRF check).
client.interceptors.request.use((config) => {
  if ((config.method || 'get').toLowerCase() !== 'get') {
    config.headers = { ...config.headers, 'X-Requested-With': 'XHR' };
  }
  return config;
});

client.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const message = err.response?.data?.error?.message || 'Something went wrong. Please try again.';
    const code = err.response?.data?.error?.code || 'UNKNOWN';
    const status = err.response?.status;

    // No (or an expired) suite session: back to the portal's sign-in, returning here after.
    if (status === 401) {
      sessionStorage.clear();
      window.location.assign(portalLoginUrl());
    }
    // Signed in, but no LMS access (or the LMS account is deactivated): the portal
    // dashboard explains it.
    if (status === 403 && code === 'NO_APP_ACCESS') {
      window.location.assign('/?denied=lms');
    }

    return Promise.reject({ code, message, status });
  },
);

export default client;
