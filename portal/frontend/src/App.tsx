import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router';
import { api, ApiError, goToLogin, type Me } from './api';
import { Icon } from './components/Icon';
import { Avatar } from './components/ui';
import { MeContext, useMe } from './useMe';
import { applyMode, applyPreferences } from './theme/theme-switch';
import { SignIn } from './pages/SignIn';
import { Dashboard } from './pages/Dashboard';
import { Profile } from './pages/Profile';
import { AdminUsers } from './pages/AdminUsers';
import { AdminAudit } from './pages/AdminAudit';
import { AdminImport } from './pages/AdminImport';
import { Inbox } from './pages/Inbox';
import { SignOut } from './pages/SignOut';
import s from './styles/portal.module.css';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<SignIn />} />
        <Route element={<SignedIn />}>
          <Route index element={<Dashboard />} />
          <Route path="profile" element={<Profile />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="signout" element={<SignOut />} />
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

/** Light/dark in one click, saved as the suite preference, so every app follows (same control in every app's top bar). */
function ThemeToggle() {
  const { me, setMe } = useMe();
  const dark = me.preferences.mode === 'dark'
    || (me.preferences.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  async function toggle() {
    const next = { preset: me.preferences.preset, mode: dark ? 'light' : 'dark' };
    applyMode(next.mode);
    setMe({ ...me, preferences: next });
    await api('/api/me/preferences', { method: 'PUT', body: JSON.stringify(next) }).catch(() => undefined);
  }
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" className={s.iconButton} onClick={() => void toggle()} aria-label={label} title={label} data-testid="theme-toggle">
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  );
}

function Shell() {
  const { me } = useMe();
  return (
    <div className={s.app}>
      <header className={s.topbar}>
        <NavLink to="/" className={s.brand} aria-label="Tektalis dashboard" title="Tektalis dashboard" data-testid="brand-home">
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
          <ThemeToggle />
          <NavLink
            to="/inbox"
            className={`${s.iconButton} ${s.inboxButton}`}
            aria-label={me.unreadCount > 0 ? `Inbox, ${me.unreadCount} unread` : 'Inbox'}
            title="Inbox"
            data-testid="inbox-link"
          >
            <Icon name="mail" />
            {me.unreadCount > 0 ? <span className={s.countBadge} aria-hidden="true">{me.unreadCount > 99 ? '99+' : me.unreadCount}</span> : null}
          </NavLink>
          <NavLink to="/profile" className={s.iconButton} aria-label="Profile and theme" title="Profile and theme">
            <Avatar name={me.name} photoUrl={me.photoUrl} />
          </NavLink>
          <span className={s.whoName}>{me.name}</span>
          <NavLink to="/signout" className={s.iconButton} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </NavLink>
        </div>
      </header>
      <main className={s.main}>
        <Outlet />
      </main>
    </div>
  );
}
