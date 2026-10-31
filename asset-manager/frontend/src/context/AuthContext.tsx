import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { getMeApi } from '../api/auth';
import { clearLocalSession } from '../api/client';
import type { User } from '../types';

// TT Suite: who is signed in comes from the portal's session (GET /auth/me reads its cookie).
// The profile is kept in memory only - never in the browser's storage.
//   signedOut    no (or an expired) suite session      -> the suite sign-in page
//   noAccess     signed in, no Asset Management role   -> the API client sends them to the dashboard
//   unavailable  AMS did not answer                    -> a message, never a sign-in loop
export type AuthStatus = 'loading' | 'ready' | 'signedOut' | 'noAccess' | 'unavailable';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => void;
  updateCurrentUser: (updatedUser: User) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function statusOf(error: unknown): AuthStatus {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return 'signedOut';
    if (error.response?.status === 403 && error.response.data?.code === 'NO_APP_ACCESS') return 'noAccess';
  }
  return 'unavailable';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Local cleanup only: the sign-out card has already ended the suite session (POST
  // /api/auth/logout) and goes to /login itself.
  const logout = useCallback(() => {
    clearLocalSession();
    setUser(null);
  }, []);

  const updateCurrentUser = useCallback((updatedUser: User) => {
    setUser(updatedUser);
  }, []);

  useEffect(() => {
    let active = true;
    const me = getMeApi();
    clearLocalSession(); // forget a profile an older build cached in localStorage
    me
      .then((profile) => {
        if (!active) return;
        setUser(profile);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setUser(null);
        setStatus(statusOf(error));
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        isAuthenticated: Boolean(user),
        isLoading: status === 'loading',
        logout,
        updateCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
