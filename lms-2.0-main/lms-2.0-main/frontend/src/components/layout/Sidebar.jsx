import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutDashboard, PlaneTakeoff, ListChecks, CalendarDays, Users, Settings, ShieldCheck, UserCog, PartyPopper, ChevronDown, X, FileBarChart, SlidersHorizontal
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { BASE_URL, asset } from '../../api/paths';

const NAV_EMPLOYEE = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['EMPLOYEE'] },
  { to: '/apply', label: 'Apply Leave', icon: PlaneTakeoff, roles: ['EMPLOYEE'] },
  { to: '/my-requests', label: 'My Requests', icon: ListChecks, roles: ['EMPLOYEE'] },
  { to: '/team-calendar', label: 'Team Calendar', icon: CalendarDays, roles: ['EMPLOYEE'] },
  { to: '/holidays', label: 'Holidays', icon: PartyPopper, roles: ['EMPLOYEE'] },
];

const NAV_MANAGEMENT = [
  { to: '/approvals', label: 'Approvals Queue', icon: ShieldCheck, roles: ['MANAGER', 'HR_ADMIN'] },
  { to: '/my-team', label: 'My Team', icon: Users, roles: ['MANAGER', 'HR_ADMIN'] },
  { to: '/delegation', label: 'Delegations', icon: UserCog, roles: ['MANAGER', 'HR_ADMIN'] },
  { to: '/reports', label: 'Reports', icon: FileBarChart, roles: ['MANAGER', 'HR_ADMIN'] },
];

const NAV_ADMIN = [
  { to: '/administration', label: 'Administration', icon: Settings, roles: ['HR_ADMIN'] },
];

// Deliberately unfiltered: preferences belong to whoever is signed in, so this group
// renders for every role rather than being gated like the three above.
const NAV_ACCOUNT = [
  { to: '/preferences', label: 'Preferences', icon: SlidersHorizontal },
];

const ADMIN_SECTIONS = [
  ['employees', 'Employees'],
  ['leave-types', 'Leave types & policy'],
  ['holidays', 'Holiday calendar'],
  ['self-approval', 'Self-approval'],
  ['working-patterns', 'Working patterns'],
  ['templates', 'Notification templates'],
  ['capacity', 'Blackout & capacity'],
  ['balance-extras', 'Encashment & comp-off'],
  ['balance-adjustment', 'Balance adjustment'],
  ['audit', 'Audit log'],
  ['ledger', 'Ledger'],
  ['org-config', 'Settings'],
];

/** Shared nav content rendered by both the desktop sidebar and the mobile drawer
 * (see AppLayout.jsx) so every route/section is reachable from either surface —
 * previously the whole sidebar, including the only way to switch Administration
 * sections, was `hidden md:flex` and unreachable on mobile entirely. */
function SidebarNav({ onNavigate }) {
  const { hasRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdministration = location.pathname === '/administration';
  const activeAdminSection = new URLSearchParams(location.search).get('section') || 'employees';
  const [adminOpen, setAdminOpen] = useState(isAdministration);

  useEffect(() => {
    if (isAdministration) setAdminOpen(true);
  }, [isAdministration]);

  const employeeItems = NAV_EMPLOYEE.filter((item) => hasRole(...item.roles));
  const managementItems = NAV_MANAGEMENT.filter((item) => hasRole(...item.roles));
  const adminItems = NAV_ADMIN.filter((item) => hasRole(...item.roles));

  const goTo = (path) => {
    navigate(path);
    onNavigate?.();
  };

  return (
    <>
      {/* Brand */}
      <a href={BASE_URL} className="brand mb-6 shrink-0" aria-label="Tektalis, go to dashboard">
        <img src={asset('brand/tektalis.png')} alt="Tektalis" className="logo" />
      </a>

      <nav className="flex-1 space-y-6 overflow-y-auto pr-1">
        {employeeItems.length > 0 && (
          <div>
            <p className="side-group-label">Employee</p>
            <div className="space-y-1">
              {employeeItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  onClick={() => onNavigate?.()}
                  className={({ isActive }) => `side-link ${isActive ? 'is-active' : ''}`}
                >
                  <Icon className="w-5 h-5" strokeWidth={2} />
                  <span className="nav-label">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}

        {managementItems.length > 0 && (
          <div>
            <p className="side-group-label">HR & management</p>
            <div className="space-y-1">
              {managementItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => onNavigate?.()}
                  className={({ isActive }) => `side-link ${isActive ? 'is-active' : ''}`}
                >
                  <Icon className="w-5 h-5" strokeWidth={2} />
                  <span className="nav-label">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}

        {adminItems.length > 0 && (
          <div>
            <div className="space-y-1">
              {adminItems.map(({ to, label, icon: Icon }) => (
                <div key={to}>
                  <button
                    type="button"
                    onClick={() => {
                      setAdminOpen((open) => !open);
                      if (!isAdministration) goTo(to);
                    }}
                    aria-expanded={adminOpen}
                    aria-controls="administration-submenu"
                    className={`side-link justify-between ${isAdministration ? 'is-active' : ''}`}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-5 h-5" strokeWidth={2} />
                      <span className="nav-label">{label}</span>
                    </span>
                    <ChevronDown className={`nav-label w-4 h-4 transition-transform ${adminOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {adminOpen && (
                    <div id="administration-submenu" className="nav-label mt-1 ml-4 space-y-0.5 border-l border-border pl-3">
                      {ADMIN_SECTIONS.map(([key, sectionLabel]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => goTo(`${to}?section=${key}`)}
                          className={`side-link !py-2 ${isAdministration && activeAdminSection === key ? 'is-active' : ''}`}
                        >
                          {sectionLabel}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="side-group-label">Account</p>
          <div className="space-y-1">
            {NAV_ACCOUNT.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => onNavigate?.()}
                className={({ isActive }) => `side-link ${isActive ? 'is-active' : ''}`}
              >
                <Icon className="w-5 h-5" strokeWidth={2} />
                <span className="nav-label">{label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </nav>
    </>
  );
}

/** Mobile menu content: a grid of large icon tiles grouped by section, the
 * "app launcher" pattern most native mobile apps use for an overflow/more
 * menu — not a shrunk clone of the desktop list. Administration is a single
 * tile here; switching between its 13 sections happens on the Administration
 * page itself via a horizontal chip bar (see Administration.jsx), so this
 * sheet never needs the desktop's nested accordion. */
function MobileMenuGrid({ onNavigate }) {
  const { hasRole } = useAuth();
  const navigate = useNavigate();

  const employeeItems = NAV_EMPLOYEE.filter((item) => hasRole(...item.roles));
  const managementItems = NAV_MANAGEMENT.filter((item) => hasRole(...item.roles));
  const adminItems = NAV_ADMIN.filter((item) => hasRole(...item.roles));

  const groups = [
    { heading: 'Employee', items: employeeItems },
    { heading: 'HR & management', items: managementItems },
    { heading: 'Admin', items: adminItems },
    { heading: 'Account', items: NAV_ACCOUNT },
  ].filter((g) => g.items.length > 0);

  const goTo = (path) => {
    navigate(path);
    onNavigate?.();
  };

  return (
    <div className="space-y-6">
      {groups.map(({ heading, items }) => (
        <div key={heading}>
          <p className="side-group-label px-1">{heading}</p>
          <div className="grid grid-cols-3 gap-2.5">
            {items.map(({ to, label, icon: Icon }) => (
              <button key={to} type="button" onClick={() => goTo(to)} className="tile flex-col !items-center text-center gap-2 active:scale-95 transition-transform">
                <Icon className="w-6 h-6" strokeWidth={2} style={{ color: 'var(--color-accent-text)' }} />
                <span className="small font-medium leading-tight">{label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Sidebar({ mobileOpen, onCloseMobile }) {
  return (
    <>
      {/* Desktop / tablet */}
      <aside className="hidden sm:flex sm:flex-col shrink-0 sticky top-0 h-screen z-30 nav" aria-label="Main">
        <SidebarNav />
      </aside>

      {/* Mobile bottom sheet — the native "more menu" pattern (grid of icon
          tiles sliding up from the bottom), distinct from the desktop sidebar */}
      {mobileOpen && createPortal(
        <div className="sm:hidden fixed inset-0 z-[90]">
          <div className="fixed inset-0 bg-black/50 animate-in fade-in duration-200" onClick={onCloseMobile} />
          <div className="fixed inset-x-0 bottom-0 max-h-[80vh] animate-in slide-in-from-bottom duration-250">
            <div className="panel panel--strong relative flex flex-col rounded-t-lg rounded-b-none max-h-[80vh] p-4 pt-3">
              <div className="mx-auto w-10 h-1.5 rounded-full bg-border mb-3 shrink-0" />
              <div className="flex items-center justify-between mb-4 shrink-0">
                <p className="h3">Menu</p>
                <button type="button" onClick={onCloseMobile} className="btn btn--ghost btn--sm !px-2" aria-label="Close menu">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                <MobileMenuGrid onNavigate={onCloseMobile} />
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
