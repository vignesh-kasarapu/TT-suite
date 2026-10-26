import { api } from './client';

export interface TokenResponse {
  access_token: string;
  expires_in: number;
}

/** PKCE exchange — backend does the code_verifier check + Entra /token call
 * server-side (the phone never sees a client secret). Matches
 * backend-py/app/schemas/auth.py's MobileTokenIn/TokenOut exactly. */
export function exchangeMobileToken(code: string, codeVerifier: string) {
  return api.post<TokenResponse>('/api/auth/mobile/token', { code, code_verifier: codeVerifier });
}

/** Dev-only bypass — server-side refuses this unless ENVIRONMENT != production
 * AND DEV_AUTH_BYPASS_ENABLED, regardless of what the client sends. */
export function devLogin() {
  return api.post<TokenResponse>('/api/auth/dev-login');
}

export function signOut() {
  return api.post<{ signed_out: boolean }>('/api/auth/signout');
}
