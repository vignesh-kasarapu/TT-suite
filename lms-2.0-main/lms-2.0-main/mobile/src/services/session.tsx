/** MIGRATION_PLAN.md §2: the phone does the Entra authorize+PKCE round trip
 * itself (expo-auth-session), then POSTs {code, code_verifier} to
 * POST /api/auth/mobile/token — the backend does the actual /token exchange
 * server-side (reusing the same resolve/issue functions the web cookie flow
 * uses) and hands back the LMS session JWT in the response body instead of a
 * cookie. This file owns that whole flow plus the resulting session state;
 * every screen reads auth state through useSession(), never SecureStore or
 * expo-auth-session directly. */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { devLogin as devLoginRequest, exchangeMobileToken, signOut as signOutRequest } from '../api/auth';
import { getMe } from '../api/employees';
import type { MeResponse } from '../types/models';
import { getToken, setToken } from './tokenStore';

WebBrowser.maybeCompleteAuthSession();

const TENANT_ID = process.env.EXPO_PUBLIC_ENTRA_TENANT_ID || '';
const CLIENT_ID = process.env.EXPO_PUBLIC_ENTRA_MOBILE_CLIENT_ID || '';
const REDIRECT_URI = process.env.EXPO_PUBLIC_MOBILE_REDIRECT_URI || 'lms://auth';
const DEV_BYPASS_AVAILABLE = process.env.EXPO_PUBLIC_DEV_AUTH_BYPASS_ENABLED === 'true';

const discovery: AuthSession.DiscoveryDocument | null = TENANT_ID
  ? {
      authorizationEndpoint: `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`,
      tokenEndpoint: `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    }
  : null;

interface SessionState {
  isLoading: boolean;
  isSignedIn: boolean;
  me: MeResponse | null;
  entraConfigured: boolean;
  devBypassAvailable: boolean;
  signInWithEntra: () => Promise<void>;
  signInDev: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession() must be called within a <SessionProvider>.');
  return ctx;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    { clientId: CLIENT_ID, redirectUri: REDIRECT_URI, scopes: ['openid', 'profile', 'email'], usePKCE: true },
    discovery,
  );

  const refreshMe = useCallback(async () => {
    try {
      setMe(await getMe());
    } catch {
      // Token missing/expired/revoked — fall back to signed-out rather than
      // leaving the UI stuck on a failed request.
      setMe(null);
      await setToken(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) await refreshMe();
      setIsLoading(false);
    })();
  }, [refreshMe]);

  const signInWithEntra = useCallback(async () => {
    if (!discovery || !CLIENT_ID) {
      throw new Error('Entra mobile client is not configured — set EXPO_PUBLIC_ENTRA_TENANT_ID / EXPO_PUBLIC_ENTRA_MOBILE_CLIENT_ID in .env.');
    }
    if (!request) return; // request builds asynchronously on first render

    const result = await promptAsync();
    if (result.type !== 'success') return; // user cancelled or dismissed
    const codeVerifier = request.codeVerifier;
    if (!codeVerifier) throw new Error('PKCE code_verifier missing from the auth request — this should never happen with usePKCE:true.');

    const { access_token } = await exchangeMobileToken(result.params.code, codeVerifier);
    await setToken(access_token);
    await refreshMe();
  }, [request, promptAsync, refreshMe]);

  const signInDev = useCallback(async () => {
    const { access_token } = await devLoginRequest();
    await setToken(access_token);
    await refreshMe();
  }, [refreshMe]);

  const signOut = useCallback(async () => {
    try {
      await signOutRequest();
    } catch {
      // Best-effort server-side signout — clear the local token regardless,
      // since the whole point of signing out is that this device stops
      // being able to act as the user even if the network call fails.
    }
    await setToken(null);
    setMe(null);
  }, []);

  return (
    <SessionContext.Provider
      value={{
        isLoading,
        isSignedIn: me !== null,
        me,
        entraConfigured: Boolean(TENANT_ID && CLIENT_ID),
        devBypassAvailable: DEV_BYPASS_AVAILABLE,
        signInWithEntra,
        signInDev,
        signOut,
        refreshMe,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
