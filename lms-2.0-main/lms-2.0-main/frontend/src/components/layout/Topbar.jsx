import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Link } from 'react-router-dom';
import { signOut } from '../../api/auth';
import NotificationBell from '../common/NotificationBell';
import Avatar from '../common/Avatar';
import EditProfileModal from '../common/EditProfileModal';
import AppSwitcher from './AppSwitcher';
import { ShieldCheck, UserCheck, Sparkles, ChevronDown, LogOut, Mail, Briefcase, X, Building, CheckCircle2, User, UserCog, Sun, Moon, Monitor, SlidersHorizontal } from 'lucide-react';

const MODE_ICON = { system: Monitor, light: Sun, dark: Moon };
const MODE_LABEL = { system: 'Following system', light: 'Light mode', dark: 'Dark mode' };

export default function Topbar({ title }) {
  const { user } = useAuth();
  const { mode, cycleMode } = useTheme();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const dropdownRef = useRef(null);

  const isHrAdmin = user?.roles?.includes('HR_ADMIN');
  const isManager = user?.roles?.includes('MANAGER');
  const ModeIcon = MODE_ICON[mode] || Monitor;

  // Close profile modal on click outside or Escape key
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsProfileOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsProfileOpen(false);
        setShowLogoutConfirm(false);
      }
    };

    if (isProfileOpen || showLogoutConfirm) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfileOpen, showLogoutConfirm]);
  // EditProfileModal handles its own Escape-key/click-outside via the shared Modal component.

  const confirmAndLogout = async () => {
    try {
      // TT Suite: the portal ends the suite session and clears its cookie (every app).
      await signOut();
    } catch {
      // Proceed regardless (e.g. session already expired/invalid) — every user should still
      // land back on the sign-in page below, not get stuck.
    } finally {
      sessionStorage.clear();
      window.location.assign('/login');
    }
  };

  const emp = user?.employee || {};
  const roleLabel = isHrAdmin ? 'HR admin portal' : isManager ? 'Manager portal' : 'Employee workspace';
  const RoleIcon = isHrAdmin ? ShieldCheck : isManager ? UserCheck : Sparkles;

  return (
    <header className="topbar z-40 mb-6">
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        <h1 className="text-base sm:text-2xl font-display font-medium truncate" style={{ letterSpacing: 'var(--font-tracking-display)' }}>{title}</h1>
        <span className="pill pill--muted hidden md:inline-flex shrink-0">
          <RoleIcon className="w-3.5 h-3.5" /> {roleLabel}
        </span>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-4 shrink-0">
        <button type="button" onClick={cycleMode} className="btn btn--ghost btn--sm !px-2" title={MODE_LABEL[mode] || 'Colour mode'} aria-label={`Colour mode: ${mode}, press to change`}>
          <ModeIcon className="w-5 h-5" strokeWidth={2} />
        </button>
        <NotificationBell />
        <AppSwitcher />

        {/* Profile Trigger Container */}
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setIsProfileOpen((prev) => !prev)}
            className="flex items-center gap-1.5 sm:gap-3 p-1 sm:p-1.5 rounded-md"
            title="View profile & settings"
            aria-expanded={isProfileOpen}
          >
            <Avatar employee={emp} size={36} className="text-xs sm:text-sm" />
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium leading-none">{emp.full_name || 'User profile'}</p>
              <p className="small muted leading-none mt-1.5">{emp.designation || 'Staff'}</p>
            </div>
            <ChevronDown className={`hidden sm:block w-4 h-4 muted transition-transform duration-200 shrink-0 ${isProfileOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Profile Pop-Up Modal Card */}
          {isProfileOpen && (
            <div className="panel panel--strong absolute right-0 mt-3 w-[calc(100vw-3rem)] max-w-80 sm:max-w-96 z-50 animate-in fade-in slide-in-from-top-3 duration-200">
              <div className="flex items-start justify-between pb-4 border-b border-border">
                <div className="flex items-center gap-3.5">
                  <Avatar employee={emp} size={56} fontSize={18} />
                  <div>
                    <h3 className="text-base font-medium flex items-center gap-1.5">
                      {emp.full_name || 'User'}
                      <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--color-success)' }} />
                    </h3>
                    <p className="small" style={{ color: 'var(--color-accent-text)' }}>{emp.designation || 'Team member'}</p>
                    <span className="pill pill--muted mt-1" style={{ fontFamily: 'monospace' }}>ID: {emp.employee_id || 'N/A'}</span>
                  </div>
                </div>
                <button onClick={() => setIsProfileOpen(false)} className="btn btn--ghost btn--sm !px-2" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Roles */}
              <div className="py-3 border-b border-border">
                <p className="small muted font-medium mb-2">Assigned roles</p>
                <div className="flex flex-wrap gap-1.5">
                  {user?.roles?.map((role) => (
                    <span key={role} className="pill pill--accent">
                      <User className="w-3 h-3" /> {role}
                    </span>
                  )) || <span className="small muted">Standard user</span>}
                </div>
              </div>

              {/* Identity & Work Information */}
              <div className="py-3 space-y-2.5 border-b border-border small">
                {emp.email && (
                  <div className="flex items-center gap-2 muted">
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate" style={{ fontFamily: 'monospace' }}>{emp.email}</span>
                  </div>
                )}
                {emp.supervisor && (
                  <div className="flex items-center gap-2 muted">
                    <Briefcase className="w-3.5 h-3.5 shrink-0" />
                    <span>Reports to: <strong style={{ color: 'var(--color-text)' }}>{emp.supervisor.full_name}</strong></span>
                  </div>
                )}
                <div className="flex items-center gap-2 muted">
                  <Building className="w-3.5 h-3.5 shrink-0" />
                  <span>Status: <strong style={{ color: 'var(--color-success)' }}>Active account</strong></span>
                </div>
              </div>

              <div className="pt-3 space-y-2">
                <Link
                  to="/preferences"
                  onClick={() => setIsProfileOpen(false)}
                  className="btn btn--secondary w-full btn--sm"
                >
                  <SlidersHorizontal className="w-4 h-4" /> Preferences
                </Link>
                <button
                  onClick={() => {
                    setIsProfileOpen(false);
                    setShowEditProfile(true);
                  }}
                  className="btn btn--secondary w-full btn--sm"
                >
                  <UserCog className="w-4 h-4" /> Edit profile
                </button>
                <button
                  onClick={() => {
                    setIsProfileOpen(false);
                    setShowLogoutConfirm(true);
                  }}
                  className="btn btn--danger w-full btn--sm"
                >
                  <LogOut className="w-4 h-4" /> Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sign Out Confirmation Modal Dialog */}
      {showLogoutConfirm &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowLogoutConfirm(false)}>
            <div className="panel max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3.5">
                <span className="ico" style={{ width: 48, height: 48, borderRadius: 'var(--radius-md)', background: 'var(--color-danger-bg)', display: 'grid', placeItems: 'center', color: 'var(--color-danger-text)' }}>
                  <LogOut className="w-6 h-6" />
                </span>
                <div>
                  <h3 className="font-display font-medium text-lg">Sign out</h3>
                  <p className="small muted">End your active LMS session</p>
                </div>
              </div>

              <p className="small" style={{ background: 'var(--color-tint-2)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
                Are you sure you want to sign out? Any unsaved form progress or draft details will be lost.
              </p>

              <div className="flex items-center gap-3">
                <button onClick={() => setShowLogoutConfirm(false)} className="btn btn--secondary flex-1 btn--sm">Cancel</button>
                <button onClick={confirmAndLogout} className="btn btn--danger flex-1 btn--sm">
                  <LogOut className="w-4 h-4" /> Yes, sign out
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showEditProfile && <EditProfileModal onClose={() => setShowEditProfile(false)} />}
    </header>
  );
}
