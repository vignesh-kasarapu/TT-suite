import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PlaneTakeoff, ListChecks, CalendarDays, Users, Settings, ShieldCheck, UserCog, PartyPopper, ChevronDown, X, FileBarChart, IdCard, LogOut
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import useMediaQuery, { BREAKPOINTS } from '../../hooks/useMediaQuery';
import EditProfileModal from '../common/EditProfileModal';
import SignOutDialog from './SignOutDialog';
import { HomeIcon } from '../common/SuiteIcon';

const NAV_EMPLOYEE = [
  { to: '/', label: 'Dashboard', icon: HomeIcon, roles: ['EMPLOYEE'] },
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

// Deliberately unfiltered: every signed-in person has one. Profile and theme live in the TT Suite
// portal (the avatar in the top bar), so they are not repeated here.
const NAV_ACCOUNT = [
  // LMS's own self-service personal details (phone, emergency contact, photo...).
  { action: 'hr-details', label: 'My HR details', icon: IdCard },
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
function SidebarNav({ onNavigate, onOpenHrDetails }) {
  const { hasRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdministration = location.pathname === '/administration';
  const activeAdminSection = new URLSearchParams(location.search).get('section') || 'employees';
  const [adminOpen, setAdminOpen] = useState(isAdministration);
  const desktopUp = useMediaQuery(BREAKPOINTS.desktop);

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

  // Icon rail (tablet): the labels are visually hidden, so each item gets a tooltip.
  const tip = (label) => (desktopUp ? undefined : label);

  const linkGroup = (items) => (
    <div className="side-nav-list">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={() => onNavigate?.()}
          title={tip(label)}
          className={({ isActive }) => `side-link ${isActive ? 'is-active' : ''}`}
        >
          <Icon strokeWidth={2} aria-hidden="true" />
          <span className="nav-label">{label}</span>
        </NavLink>
      ))}
    </div>
  );

  // No logo here: the Tektalis logo lives in the top bar, as in every TT Suite app.
  return (
    <nav className="side-nav-groups" aria-label="Main navigation">
      {employeeItems.length > 0 && (
        <div>
          <p className="side-group-label">Employee</p>
          {linkGroup(employeeItems)}
        </div>
      )}

      {managementItems.length > 0 && (
        <div>
          <p className="side-group-label">HR & management</p>
          {linkGroup(managementItems)}
        </div>
      )}

      {adminItems.length > 0 && (
        <div className="side-nav-list">
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
                title={tip(label)}
                className={`side-link side-link--parent ${isAdministration ? 'is-active' : ''}`}
              >
                <span className="side-link-inner">
                  <Icon strokeWidth={2} aria-hidden="true" />
                  <span className="nav-label">{label}</span>
                </span>
                <ChevronDown className={`side-chevron !w-4 !h-4 transition-transform ${adminOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>

              {adminOpen && (
                <div id="administration-submenu" className="side-sub">
                  {ADMIN_SECTIONS.map(([key, sectionLabel]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => goTo(`${to}?section=${key}`)}
                      className={`side-link ${isAdministration && activeAdminSection === key ? 'is-active' : ''}`}
                    >
                      {sectionLabel}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="side-group-label">Account</p>
        <div className="side-nav-list">
          {NAV_ACCOUNT.map(({ href, action, label, icon: Icon }) => (href ? (
            <a key={href} href={href} className="side-link" title={tip(label)}>
              <Icon strokeWidth={2} aria-hidden="true" />
              <span className="nav-label">{label}</span>
            </a>
          ) : (
            <button key={action} type="button" className="side-link" title={tip(label)} onClick={() => onOpenHrDetails?.()}>
              <Icon strokeWidth={2} aria-hidden="true" />
              <span className="nav-label">{label}</span>
            </button>
          )))}
        </div>
      </div>
    </nav>
  );
}

/** Mobile menu content: a grid of large icon tiles grouped by section, the
 * "app launcher" pattern most native mobile apps use for an overflow/more
 * menu — not a shrunk clone of the desktop list. Administration is a single
 * tile here; switching between its 13 sections happens on the Administration
 * page itself via a horizontal chip bar (see Administration.jsx), so this
 * sheet never needs the desktop's nested accordion. */
function MobileMenuGrid({ onNavigate, onOpenHrDetails, onSignOut }) {
  const { hasRole } = useAuth();
  const navigate = useNavigate();

  const employeeItems = NAV_EMPLOYEE.filter((item) => hasRole(...item.roles));
  const managementItems = NAV_MANAGEMENT.filter((item) => hasRole(...item.roles));
  const adminItems = NAV_ADMIN.filter((item) => hasRole(...item.roles));

  const groups = [
    { heading: 'Employee', items: employeeItems },
    { heading: 'HR & management', items: managementItems },
    { heading: 'Admin', items: adminItems },
    // Sign out is here on phones: the top bar has no room for it (as in Kanban's More sheet).
    { heading: 'Account', items: [...NAV_ACCOUNT, { action: 'sign-out', label: 'Sign out', icon: LogOut }] },
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
            {items.map(({ to, href, action, label, icon: Icon }) => {
              const tile = (
                <>
                  <Icon className="w-6 h-6" strokeWidth={2} style={{ color: 'var(--color-accent-text)' }} />
                  <span className="small font-medium leading-tight">{label}</span>
                </>
              );
              const className = 'tile flex-col !items-center text-center gap-2 active:scale-95 transition-transform';
              return href ? (
                <a key={href} href={href} className={className} style={{ color: 'inherit', textDecoration: 'none' }}>{tile}</a>
              ) : (
                <button key={to || action} type="button" className={className}
                  data-testid={action === 'sign-out' ? 'menu-sign-out' : undefined}
                  aria-haspopup={action === 'sign-out' ? 'dialog' : undefined}
                  onClick={() => {
                    if (action === 'sign-out') { onSignOut?.(); return; }
                    if (action) { onNavigate?.(); onOpenHrDetails?.(); return; }
                    goTo(to);
                  }}>{tile}</button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Sidebar({ mobileOpen, onCloseMobile }) {
  const [showHrDetails, setShowHrDetails] = useState(false);
  const openHrDetails = () => setShowHrDetails(true);
  const [signingOut, setSigningOut] = useState(false);
  return (
    <>
      {showHrDetails && <EditProfileModal onClose={() => setShowHrDetails(false)} />}
      {/* The phone Menu sheet's "Sign out" opens the same card as the top bar's button; the
          sheet stays open underneath so focus can return to the tile on Cancel. */}
      <SignOutDialog open={signingOut} onClose={() => setSigningOut(false)} />
      {/* Desktop / tablet */}
      <aside className="side-nav hidden sm:flex" aria-label="Main">
        <SidebarNav onOpenHrDetails={openHrDetails} />
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
                <MobileMenuGrid onNavigate={onCloseMobile} onOpenHrDetails={openHrDetails} onSignOut={() => setSigningOut(true)} />
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
