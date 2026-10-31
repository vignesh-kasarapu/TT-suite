import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';

// GET /auth/me answers with the test's signed-in person: the tests put it under 'ams_user'
// before rendering (read when the call is made); no person is a 401 (signed out).
vi.mock('../api/auth', () => ({
  getMeApi: vi.fn(() => {
    const raw = localStorage.getItem('ams_user');
    if (raw) return Promise.resolve(JSON.parse(raw));
    const config = { headers: new AxiosHeaders() };
    return Promise.reject(
      new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, {
        status: 401, statusText: 'Unauthorized', headers: {}, config, data: { code: 'NO_SESSION' },
      }),
    );
  }),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});
