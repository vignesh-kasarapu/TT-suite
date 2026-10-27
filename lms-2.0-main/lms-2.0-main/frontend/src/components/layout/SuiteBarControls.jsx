import { useCallback, useEffect, useState } from 'react';
import { Sun, Moon, Mail, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { getPortalMe, savePortalPreferences, signOut } from '../../api/portal';
import { applyMode } from '../../theme/theme-switch';
import Avatar from '../common/Avatar';

const ICON_BUTTON = {
  width: 36, height: 36, minWidth: 36, minHeight: 36, padding: 0,
  display: 'inline-grid', placeItems: 'center', position: 'relative', flexShrink: 0,
};

function effectiveMode() {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Light/dark toggle: applies at once, then saves the suite-wide preference. */
function ThemeToggle() {
  const { preset, setMode } = useTheme();
  const [current, setCurrent] = useState(effectiveMode);

  // Follow the OS while the saved mode is 'system', and pick up the portal's preference.
  useEffect(() => {
    const sync = () => setCurrent(effectiveMode());
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      media?.removeEventListener?.('change', sync);
      observer.disconnect();
    };
  }, []);

  const toggle = () => {
    const next = current === 'dark' ? 'light' : 'dark';
    applyMode(next);
    setMode?.(next);
    setCurrent(next);
    savePortalPreferences({ preset, mode: next }).catch(() => {
      // Offline / not signed in to the portal: the choice still applies here.
    });
  };

  const label = current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  const Icon = current === 'dark' ? Sun : Moon;
  return (
    <button type="button" className="btn btn--ghost btn--sm" style={ICON_BUTTON} onClick={toggle}
      data-testid="theme-toggle" aria-label={label} title={label}>
      <Icon className="w-5 h-5" strokeWidth={2} />
    </button>
  );
}

/** Link to the portal's inbox with the unread count from GET /api/me. */
function InboxLink() {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    getPortalMe().then((me) => setUnread(Number(me?.unreadCount) || 0)).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const label = unread > 0 ? `Inbox, ${unread} unread` : 'Inbox';
  return (
    <a href="/inbox" className="btn btn--ghost btn--sm" style={ICON_BUTTON} data-testid="inbox-link" aria-label={label} title={label}>
      <Mail className="w-5 h-5" strokeWidth={2} />
      {unread > 0 && (
        <span aria-hidden="true" style={{
          position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, padding: '0 4px',
          borderRadius: 'var(--radius-pill)', background: 'var(--color-accent)', color: 'var(--color-accent-contrast)',
          fontSize: 10, fontWeight: 600, lineHeight: '16px', textAlign: 'center',
        }}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </a>
  );
}

/** The TT Suite's standard right-hand bar controls, in the suite-wide order:
 * light/dark toggle, inbox, avatar + name (the portal's /profile), sign out (/signout). */
export default function SuiteBarControls() {
  const { user } = useAuth();
  const emp = user?.employee || {};

  return (
    <>
      <ThemeToggle />
      <InboxLink />
      <a href="/profile" className="flex items-center gap-2 rounded-md shrink-0 min-w-0"
        style={{ color: 'inherit', textDecoration: 'none' }} title="Your profile" aria-label={`Profile: ${emp.full_name || 'you'}`}>
        <Avatar employee={emp} size={36} className="text-xs sm:text-sm" />
        <span className="hidden sm:block text-sm font-medium truncate" style={{ maxWidth: 160 }}>{emp.full_name || 'Profile'}</span>
      </a>
      <button type="button" className="btn btn--ghost btn--sm" style={ICON_BUTTON}
        onClick={() => { sessionStorage.clear(); signOut(); }} aria-label="Sign out" title="Sign out" data-testid="sign-out">
        <LogOut className="w-5 h-5" strokeWidth={2} />
      </button>
    </>
  );
}
