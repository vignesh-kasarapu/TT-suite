import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { getMeApi } from '../api/auth';
import { USER_STORAGE_KEY, goToSuiteSignOut } from '../api/client';
import type { User } from '../types';

// TT Suite: who is signed in comes from the portal's session (GET /auth/me reads its cookie).
// The last profile is cached only so the page renders at once; the server answer replaces it.
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

function readStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function statusOf(error: unknown): AuthStatus {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return 'signedOut';
    if (error.response?.status === 403 && error.response.data?.code === 'NO_APP_ACCESS') return 'noAccess';
  }
  return 'unavailable';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => readStoredUser());
  const [status, setStatus] = useState<AuthStatus>(() => (readStoredUser() ? 'ready' : 'loading'));

  const logout = useCallback(() => {
    setUser(null);
    goToSuiteSignOut();
  }, []);

  const updateCurrentUser = useCallback((updatedUser: User) => {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updatedUser));
    setUser(updatedUser);
  }, []);

  useEffect(() => {
    let active = true;
    getMeApi()
      .then((profile) => {
        if (!active) return;
        updateCurrentUser(profile);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        const next = statusOf(error);
        // A cached profile keeps the page usable through a brief outage; a refusal never does.
        if (next === 'unavailable' && readStoredUser()) return;
        localStorage.removeItem(USER_STORAGE_KEY);
        setUser(null);
        setStatus(next);
      });
    return () => {
      active = false;
    };
  }, [updateCurrentUser]);

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
