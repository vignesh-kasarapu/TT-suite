import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useSuite } from '../../context/SuiteContext';
import { savePortalPreferences } from '../../api/portal';
import { applyMode } from '../../theme/theme-switch';
import Avatar from '../common/Avatar';
import SuiteIcon from '../common/SuiteIcon';
import SignOutDialog from './SignOutDialog';

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

  return (
    <button type="button" className="suite-action" onClick={toggle}
      data-testid="theme-toggle" aria-label={label} title={label}>
      <SuiteIcon name={current === 'dark' ? 'sun' : 'moon'} size={20} />
    </button>
  );
}

/** The TT Suite's standard right-hand bar controls, in the suite-wide order:
 * light/dark toggle | avatar + name (the portal's /profile), sign out (a card: this device / all devices). */
export default function SuiteBarControls() {
  const { user } = useAuth();
  const { me, loadedAt } = useSuite();
  const emp = user?.employee || {};
  const [signingOut, setSigningOut] = useState(false);
  // The suite profile photo (uploaded on the portal's Profile page), as in every suite app;
  // initials when there is none. `v` changes on each portal refresh so a new photo shows.
  const photoSrc = me?.photoUrl
    ? `${me.photoUrl}${me.photoUrl.includes('?') ? '&' : '?'}v=${loadedAt || 0}`
    : null;
  // Initials only (not the LMS-stored avatar) when the suite has no photo.
  const avatarPerson = { full_name: emp.full_name || me?.name };
  // The company employee code the global admin gave (the portal's /api/me); none for older people.
  const employeeCode = me?.employeeCode || null;

  return (
    <>
      <ThemeToggle />
      <span className="who-divider" aria-hidden="true" />
      {/* The profile (name, picture, theme) is the portal's - a whole-page link. */}
      <a href="/profile" className="who-profile" title="Your profile"
        aria-label={`Profile: ${emp.full_name || 'you'}`} data-testid="profile-link">
        <Avatar employee={avatarPerson} photoSrc={photoSrc} alt="" size={28} fontSize={12} />
        <span className="who-text">
          <span className="who-name">{emp.full_name || 'Profile'}</span>
          {employeeCode && (
            <span className="who-code" data-testid="header-employee-code">{employeeCode}</span>
          )}
        </span>
      </a>
      <button type="button" className="top-action who-sign-out"
        onClick={() => setSigningOut(true)} aria-haspopup="dialog" aria-label="Sign out" title="Sign out" data-testid="sign-out">
        <SuiteIcon name="logout" size={18} />
      </button>
      <SignOutDialog open={signingOut} onClose={() => setSigningOut(false)} />
    </>
  );
}
