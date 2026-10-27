import React, { useCallback, useEffect, useState } from 'react';
import { LogOut, Mail, Moon, Sun } from 'lucide-react';
import { effectiveMode, toggleMode } from '../theme/theme-switch';

// TT Suite: the same controls on the right of every suite app's top bar, in this order:
// light/dark toggle, Inbox, avatar + name (the portal profile), sign out (the portal's /signout).
// Inbox count and photo come from the portal's GET /api/me (same origin, cookie sent).

interface SuiteMe {
  name?: string;
  photoUrl?: string | null;
  unreadCount?: number;
}

export function unreadLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

const ICON_BUTTON =
  'relative inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600';

interface SuiteHeaderControlsProps {
  /** The AMS user's name (synced from the suite); the portal's answer replaces it when it comes. */
  name: string;
  onSignOut: () => void;
}

export const SuiteHeaderControls: React.FC<SuiteHeaderControlsProps> = ({ name, onSignOut }) => {
  const [mode, setMode] = useState<'light' | 'dark'>(() => effectiveMode());
  const [me, setMe] = useState<SuiteMe | null>(null);

  const loadMe = useCallback(() => {
    fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SuiteMe | null) => {
        if (data) setMe(data);
        setMode(effectiveMode());
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadMe();
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadMe();
    };
    document.addEventListener('visibilitychange', onVisible);
    // The theme can change under us (system mode following the OS, or a re-read on focus).
    const observer =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => setMode(effectiveMode()))
        : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      observer?.disconnect();
    };
  }, [loadMe]);

  const handleToggle = () => {
    setMode(effectiveMode() === 'dark' ? 'light' : 'dark');
    void toggleMode();
  };

  const unread = Math.max(0, me?.unreadCount ?? 0);
  const displayName = me?.name?.trim() || name;
  const isDark = mode === 'dark';

  return (
    <div className="flex items-center gap-2" data-testid="suite-header-controls">
      <button
        type="button"
        data-testid="theme-toggle"
        onClick={handleToggle}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className={ICON_BUTTON}
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <a
        href="/inbox"
        data-testid="inbox-link"
        aria-label={unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'}
        title="Inbox"
        className={ICON_BUTTON}
      >
        <Mail className="w-4 h-4" />
        {unread > 0 && (
          <span
            data-testid="inbox-badge"
            className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold leading-[18px] text-center"
          >
            {unreadLabel(unread)}
          </span>
        )}
      </a>

      <a
        href="/profile"
        data-testid="profile-link"
        title="Your profile"
        className="inline-flex items-center gap-2 h-9 pl-1 pr-2.5 rounded-lg hover:bg-slate-50 text-sm font-medium text-slate-900 transition-colors max-w-[220px]"
      >
        {me?.photoUrl ? (
          <img src={me.photoUrl} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0"
          >
            {initialsOf(displayName)}
          </span>
        )}
        <span className="truncate">{displayName}</span>
      </a>

      <button
        type="button"
        data-testid="header-sign-out"
        onClick={onSignOut}
        aria-label="Sign out"
        title="Sign out"
        className={ICON_BUTTON}
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
};
