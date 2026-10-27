import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { authApi, suiteApi } from "../models/api";
import { ApiError } from "../models/http";
import type { Me, Role, SuiteMe, SuitePreferences } from "../models/types";
import { applyPreferences, DEFAULT_PREFERENCES } from "../theme/theme-switch";

// Sign-in belongs to the TT Suite portal: the session cookie is already there when EMS loads.
// The EMS user (roles, profile) comes from the EMS API; theme and app access come from the portal's /api/me.
interface AuthState {
  user: Me | null;
  suite: SuiteMe | null;
  prefs: SuitePreferences;
  ready: boolean;
  error: ApiError | null;
  retry: () => void;
  /** Sign-out is the portal's: /signout asks "this device or all devices". */
  signOut: () => void;
  /** Light/dark from the top bar: applied at once, then saved for every suite app. */
  toggleMode: () => void;
  /** Re-reads the portal profile (unread inbox count). */
  reloadSuite: () => void;
  refresh: (me: Me) => void;
  has: (role: Role) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [suite, setSuite] = useState<SuiteMe | null>(null);
  const [prefs, setPrefs] = useState<SuitePreferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setError(null);
    applyPreferences();
    // The portal profile only adds theme and the app switcher, so EMS still opens if it fails.
    suiteApi.me().then((s) => {
      setSuite(s);
      setPrefs(applyPreferences(s.preferences));
    }).catch(() => undefined);
    authApi.me().then((me) => { setUser(me); setReady(true); }).catch((e: ApiError) => {
      // 401 / NO_APP_ACCESS already redirect to the portal; keep the skeleton while the browser leaves
      if (!(e.status === 401 || e.code === "NO_APP_ACCESS")) { setError(e); setReady(true); }
    });
  }, []);

  useEffect(load, [load]);

  const signOut = useCallback(() => window.location.assign("/signout"), []);

  const reloadSuite = useCallback(() => { suiteApi.me().then(setSuite).catch(() => undefined); }, []);
  // The inbox count is refreshed whenever the person comes back to this tab
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") reloadSuite(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reloadSuite]);

  const toggleMode = () => {
    const next = effectiveMode() === "dark" ? "light" : "dark";
    setPrefs(applyPreferences({ preset: prefs.preset, mode: next }));
    suiteApi.saveMode(prefs.preset, next).catch(() => undefined);
  };

  const has = (role: Role) => !!user?.roles.includes(role);

  return (
    <AuthContext.Provider value={{ user, suite, prefs, ready, error, retry: load, signOut, toggleMode, reloadSuite, has, refresh: setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

/** The mode on screen: <html data-theme>, or the device setting when the saved mode is "system". */
export function effectiveMode(): "light" | "dark" {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** For pages behind the sign-in gate, where the user is always present. */
export function useMe(): Me {
  const { user } = useAuth();
  if (!user) throw new Error("useMe without a signed-in user");
  return user;
}
