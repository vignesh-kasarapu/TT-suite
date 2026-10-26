import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router';
import { api, ApiError, goToLogin, type Me } from './api';
import { Icon } from './components/Icon';
import { Avatar } from './components/ui';
import { MeContext, useMe } from './useMe';
import { applyPreferences } from './theme/theme-switch';
import { SignIn } from './pages/SignIn';
import { Dashboard } from './pages/Dashboard';
import { Profile } from './pages/Profile';
import { AdminUsers } from './pages/AdminUsers';
import { AdminAudit } from './pages/AdminAudit';
import { AdminImport } from './pages/AdminImport';
import s from './styles/portal.module.css';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<SignIn />} />
        <Route element={<SignedIn />}>
          <Route index element={<Dashboard />} />
          <Route path="profile" element={<Profile />} />
          <Route path="admin" element={<AdminOnly />}>
            <Route index element={<AdminUsers />} />
            <Route path="audit" element={<AdminAudit />} />
            <Route path="import" element={<AdminImport />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

/** Loads /api/me once; no session -> the sign-in page (coming back here afterwards). */
function SignedIn() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Me>('/api/me')
      .then((m) => {
        applyPreferences(m.preferences);
        setMe(m);
      })
      .catch((err) => (err instanceof ApiError && err.status === 401 ? goToLogin() : setFailed(true)));
  }, []);
  if (failed) return <p className={s.main}>The suite is not reachable right now. Try again in a moment.</p>;
  if (!me) return null;
  return (
    <MeContext.Provider value={{ me, setMe }}>
      <Shell />
    </MeContext.Provider>
  );
}

function AdminOnly() {
  const { me } = useMe();
  return me.isGlobalAdmin ? <Outlet /> : <Navigate to="/" replace />;
}

async function signOut() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  window.location.assign('/login');
}

function Shell() {
  const { me } = useMe();
  return (
    <div className={s.app}>
      <header className={s.topbar}>
        <NavLink to="/" className={s.brand} aria-label="Dashboard">
          <span className={s.brandMark}>
            <img className={s.logo} src="/brand/tektalis.png" alt="Tektalis" width={262} height={57} />
          </span>
        </NavLink>
        <nav className={s.nav} aria-label="Main">
          <NavLink to="/" end className={s.navLink}>
            <Icon name="home" size={18} />
            <span className={s.navLabel}>Dashboard</span>
          </NavLink>
          {me.isGlobalAdmin ? (
            <NavLink to="/admin" className={s.navLink}>
              <Icon name="users" size={18} />
              <span className={s.navLabel}>Users &amp; access</span>
            </NavLink>
          ) : null}
        </nav>
        <div className={s.who}>
          <NavLink to="/profile" className={s.iconButton} aria-label="Profile and theme" title="Profile and theme">
            <Avatar name={me.name} photoUrl={me.photoUrl} />
          </NavLink>
          <span className={s.whoName}>{me.name}</span>
          <button type="button" className={s.iconButton} onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </header>
      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}
