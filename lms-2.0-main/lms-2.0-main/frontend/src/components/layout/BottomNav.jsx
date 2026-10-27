import { NavLink } from 'react-router-dom';
import { PlaneTakeoff, ShieldCheck, ListChecks, Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { HomeIcon } from '../common/SuiteIcon';

// Mobile bottom bar: highest-frequency destinations for the role (FRD 7.2),
// plus a "Menu" button opening the full nav drawer (Sidebar.jsx) so every
// route — Team Calendar, Holidays, My Team, Delegations, Administration and
// all of its sections — stays reachable on mobile, not just these shortcuts.
export default function BottomNav({ onOpenMenu }) {
  const { hasRole } = useAuth();
  const isApprover = hasRole('MANAGER', 'HR_ADMIN');

  const items = isApprover
    ? [
        { to: '/', icon: HomeIcon, label: 'Home' },
        { to: '/approvals', icon: ShieldCheck, label: 'Approvals' },
        { to: '/apply', icon: PlaneTakeoff, label: 'Apply' },
        { to: '/my-requests', icon: ListChecks, label: 'Requests' },
      ]
    : [
        { to: '/', icon: HomeIcon, label: 'Home' },
        { to: '/apply', icon: PlaneTakeoff, label: 'Apply' },
        { to: '/my-requests', icon: ListChecks, label: 'Requests' },
      ];

  return (
    <nav className="nav bottom-nav sm:hidden" aria-label="Main">
      {items.map(({ to, icon: Icon, label }) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'is-active' : '')}>
          <Icon strokeWidth={1.75} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
      <button type="button" onClick={onOpenMenu}>
        <Menu strokeWidth={1.75} aria-hidden="true" />
        <span>Menu</span>
      </button>
    </nav>
  );
}
