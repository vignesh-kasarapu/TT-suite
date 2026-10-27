import { useAuth } from '../../context/AuthContext';
import NotificationBell from '../common/NotificationBell';
import AppSwitcher from './AppSwitcher';
import SuiteBarControls from './SuiteBarControls';
import { ShieldCheck, UserCheck, Sparkles } from 'lucide-react';

/** 64px bar. Right side: LMS's own notifications and the app switcher, then the TT Suite's
 * standard controls (light/dark, inbox, profile, sign out — see SuiteBarControls). "My HR
 * details" lives in the sidebar's Account group. */
export default function Topbar({ title }) {
  const { user } = useAuth();
  const isHrAdmin = user?.roles?.includes('HR_ADMIN');
  const isManager = user?.roles?.includes('MANAGER');
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

      <div className="flex items-center gap-1 sm:gap-3 shrink-0">
        <NotificationBell />
        <AppSwitcher />
        <SuiteBarControls />
      </div>
    </header>
  );
}
