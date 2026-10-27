import React, { useCallback, useEffect, useRef, useState } from 'react';
import { effectiveMode, toggleMode } from './theme-switch';
import { SignOutDialog } from './SignOutDialog';
import { SuiteIcon } from './SuiteIcon';
import styles from './SuiteHeaderControls.module.css';

// TT Suite: the same controls on the right of every suite app's top bar (Kanban's order and glyphs):
// [the app's notifications, rendered by the shell just before these] light/dark toggle | divider |
// avatar + name (the portal profile), sign out (a card: this device or all devices).
// Name and photo come from the portal's GET /api/me (same origin, cookie sent).

interface SuiteMe {
  name?: string;
  employeeCode?: string | null;
  photoUrl?: string | null;
  access?: Partial<Record<'kanban' | 'lms' | 'expense' | 'ams' | 'resume', string | null>>;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

interface SuiteHeaderControlsProps {
  /** The user's name here (synced from the suite); the portal's answer replaces it when it comes. */
  name: string;
  /** Local cleanup, called once the portal has signed the person out. */
  onSignOut: () => void;
  /** Hands the portal's /api/me to the shell (the app switcher reads `access` from it). */
  onPortalMe?: (me: SuiteMe) => void;
}

export const SuiteHeaderControls: React.FC<SuiteHeaderControlsProps> = ({ name, onSignOut, onPortalMe }) => {
  const [mode, setMode] = useState<'light' | 'dark'>(() => effectiveMode());
  const [me, setMe] = useState<SuiteMe | null>(null);
  // Bumped on every successful /api/me read: the photo URL is always /api/me/photo, so a new
  // upload on the dashboard's Profile page needs a fresh query string to bypass the browser cache.
  const [photoVersion, setPhotoVersion] = useState(0);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const signOutButtonRef = useRef<HTMLButtonElement>(null);

  const loadMe = useCallback(() => {
    fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SuiteMe | null) => {
        if (data) {
          setMe(data);
          setPhotoVersion((v) => v + 1);
          setPhotoFailed(false);
          onPortalMe?.(data);
        }
        setMode(effectiveMode());
      })
      .catch(() => undefined);
  }, [onPortalMe]);

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

  const displayName = me?.name?.trim() || name;
  const photoUrl = typeof me?.photoUrl === 'string' && me.photoUrl.trim() ? me.photoUrl.trim() : null;
  const photoSrc = photoUrl
    ? `${photoUrl}${photoUrl.includes('?') ? '&' : '?'}v=${photoVersion}`
    : null;
  const isDark = mode === 'dark';

  return (
    <>
      <div className={styles.controls} data-testid="suite-header-controls">
        <button
          type="button"
          data-testid="theme-toggle"
          onClick={handleToggle}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className={styles.suiteAction}
        >
          <SuiteIcon name={isDark ? 'sun' : 'moon'} size={20} />
        </button>

        <span className={styles.divider} aria-hidden="true" data-testid="header-divider" />

        <a href="/profile" data-testid="profile-link" title="Your profile" className={styles.whoProfile}>
          {photoSrc && !photoFailed ? (
            <img
              key={photoSrc}
              src={photoSrc}
              alt=""
              className={styles.avatarImg}
              width={28}
              height={28}
              data-testid="header-avatar-photo"
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <span aria-hidden="true" className={styles.avatar}>
              {initialsOf(displayName)}
            </span>
          )}
          <span className={styles.whoText}>
            <span className={styles.whoName}>{displayName}</span>
            {me?.employeeCode ? (
              <span className={styles.whoCode} data-testid="header-employee-code">{me.employeeCode}</span>
            ) : null}
          </span>
        </a>

        <button
          type="button"
          ref={signOutButtonRef}
          data-testid="header-sign-out"
          onClick={() => setSignOutOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={signOutOpen}
          aria-label="Sign out"
          title="Sign out"
          className={styles.whoAction}
        >
          <SuiteIcon name="logout" size={18} />
        </button>
      </div>
      {signOutOpen && (
        <SignOutDialog
          onClose={() => setSignOutOpen(false)}
          onSignedOut={onSignOut}
          returnFocusTo={signOutButtonRef}
        />
      )}
    </>
  );
};
