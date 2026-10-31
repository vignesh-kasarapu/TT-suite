import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight,
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  FolderOpen,
  Laptop,
  MoreHorizontal,
  Package,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import styles from './Layout.module.css';
import { listAssetRequestsApi } from '../api/assetRequests';
import { AppSwitcher, type SuiteAccess } from './AppSwitcher';
import { SuiteHeaderControls } from './SuiteHeaderControls';
import { SuiteIcon } from './SuiteIcon';
import { listMaintenanceRecordsApi } from '../api/maintenance';
import { listReplacementRequestsApi } from '../api/replacements';
import { useAuth } from '../context/AuthContext';
import type {
  AssetRequest,
  MaintenanceRecord,
  ReplacementRequest,
  UserRole,
} from '../types';

export const PENDING_REQUESTS_UPDATED_EVENT = 'ams:pending-updated';

export function notifyPendingRequestsUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PENDING_REQUESTS_UPDATED_EVENT));
  }
}

// The Dashboard item draws the suite's house glyph (Kanban's first nav item); the rest are lucide.
const HomeIcon: React.FC<{ className?: string; size?: number }> = ({ className, size = 22 }) => (
  <SuiteIcon name="home" size={size} className={className} />
);

const LucideGlyph: React.FC<{ icon: LucideIcon; className?: string }> = ({ icon: Glyph, className }) => (
  <Glyph className={className} size={22} strokeWidth={1.75} aria-hidden="true" />
);

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon | React.FC<{ className?: string; size?: number }>;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Workspace Overview',
    to: '/dashboard',
    icon: HomeIcon,
    roles: ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE'],
  },
  {
    label: 'My Assets',
    to: '/my-assets',
    icon: Laptop,
    roles: ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE'],
  },
  {
    label: 'Replacement Requests',
    to: '/replacements',
    icon: ArrowLeftRight,
    roles: ['EMPLOYEE'],
  },
  {
    label: 'Asset Requests',
    to: '/asset-requests',
    icon: ClipboardList,
    roles: ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE'],
  },
  {
    label: 'Asset Register',
    to: '/assets',
    icon: Package,
    roles: ['ADMIN', 'ASSET_MANAGER'],
  },
  {
    label: 'Categories',
    to: '/categories',
    icon: FolderOpen,
    roles: ['ADMIN', 'ASSET_MANAGER'],
  },
  {
    label: 'Maintenance Log',
    to: '/maintenance',
    icon: Wrench,
    roles: ['ADMIN', 'ASSET_MANAGER'],
  },
  {
    label: 'Employee Offboarding',
    to: '/offboarding',
    icon: ClipboardCheck,
    roles: ['ADMIN', 'ASSET_MANAGER'],
  },
  {
    label: 'Reports & Export',
    to: '/reports',
    icon: BarChart3,
    roles: ['ADMIN', 'ASSET_MANAGER'],
  },
  {
    label: 'User Management',
    to: '/users',
    icon: Users,
    roles: ['ADMIN'],
  },
];

// Phone bottom bar: with more than PHONE_BAR_MAX destinations, the first PHONE_BAR_SLOTS stay in
// the bar and the rest move to a "More" sheet (the suite's phone pattern, as in Kanban's shell).
const PHONE_BAR_MAX = 5;
const PHONE_BAR_SLOTS = 4;

/** The phone "More" sheet: a native modal <dialog> anchored to the bottom of the screen. */
const MoreSheet: React.FC<{
  items: NavItem[];
  onClose: () => void;
  badgeFor: (path: string) => number;
}> = ({ items, onClose, badgeFor }) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.open) return;
    if (typeof el.showModal === 'function') el.showModal();
    else el.setAttribute('open', '');
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby="ams-more-sheet-title"
      data-testid="more-sheet"
      onClose={onClose}
      onClick={(e) => {
        // A tap on the backdrop (the dialog element itself, outside the panel) closes the sheet.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.sheetHead}>
        <h2 id="ams-more-sheet-title">More</h2>
        <button type="button" className={styles.sheetClose} aria-label="Close menu" title="Close menu" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <ul className={styles.sheetList}>
        {items.map((item) => {
          const Icon = item.icon;
          const count = badgeFor(item.to);
          return (
            <li key={item.to}>
              <NavLink to={item.to} className={styles.sheetItem} onClick={onClose}>
                {Icon === HomeIcon ? (
                  <HomeIcon className={styles.icon} size={22} />
                ) : (
                  <LucideGlyph icon={Icon as LucideIcon} className={styles.icon} />
                )}
                <span className={styles.sheetLabel}>{item.label}</span>
                {count > 0 && (
                  <span className={styles.sheetCount} title={`${count} pending item${count === 1 ? '' : 's'}`}>
                    {count}
                  </span>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
};

export function getRoleBadgeClasses(role: UserRole): string {
  switch (role) {
    case 'ADMIN':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'ASSET_MANAGER':
      return 'bg-cyan-50 text-cyan-700 border-cyan-200';
    case 'EMPLOYEE':
    default:
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
}

export const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const location = useLocation();

  const [pendingReplacementsCount, setPendingReplacementsCount] =
    useState<number>(0);
  const [pendingAssetRequestsCount, setPendingAssetRequestsCount] =
    useState<number>(0);
  const [openMaintenanceCount, setOpenMaintenanceCount] = useState<number>(0);
  // The portal's GET /api/me (fetched by SuiteHeaderControls): the app switcher's `access`.
  const [portalMe, setPortalMe] = useState<SuiteAccess | null>(null);

  const isManagerOrAdmin =
    user?.role === 'ADMIN' || user?.role === 'ASSET_MANAGER';

  const fetchPendingCounts = useCallback(async () => {
    if (!user) {
      setPendingReplacementsCount(0);
      setPendingAssetRequestsCount(0);
      setOpenMaintenanceCount(0);
      return;
    }

    try {
      const reqPromise = Promise.resolve(listReplacementRequestsApi()).catch(
        () => [] as ReplacementRequest[],
      );

      const assetReqPromise = Promise.resolve(
        listAssetRequestsApi('PENDING'),
      ).catch(() => [] as AssetRequest[]);

      const maintPromise =
        user.role === 'ADMIN' || user.role === 'ASSET_MANAGER'
          ? Promise.resolve(
              listMaintenanceRecordsApi({ open_only: true }),
            ).catch(() => [] as MaintenanceRecord[])
          : Promise.resolve([] as MaintenanceRecord[]);

      const [pendingReqs, pendingAssetReqs, openMaint] = await Promise.all([
        reqPromise,
        assetReqPromise,
        maintPromise,
      ]);

      setPendingReplacementsCount(
        Array.isArray(pendingReqs)
          ? pendingReqs.filter(
              (r) => r.status === 'PENDING' || r.status === 'ON_HOLD',
            ).length
          : 0,
      );
      setPendingAssetRequestsCount(
        Array.isArray(pendingAssetReqs)
          ? pendingAssetReqs.filter((r) => r.status === 'PENDING').length
          : 0,
      );
      setOpenMaintenanceCount(
        Array.isArray(openMaint)
          ? openMaint.filter((m) => !m.closed_on).length
          : 0,
      );
    } catch {
      // Ignore background indicator errors
    }
  }, [user]);

  useEffect(() => {
    fetchPendingCounts();
  }, [fetchPendingCounts, location.pathname]);

  useEffect(() => {
    const handleUpdated = () => {
      fetchPendingCounts();
    };
    window.addEventListener(PENDING_REQUESTS_UPDATED_EVENT, handleUpdated);
    return () => {
      window.removeEventListener(PENDING_REQUESTS_UPDATED_EVENT, handleUpdated);
    };
  }, [fetchPendingCounts]);

  const totalPendingCount =
    pendingReplacementsCount + pendingAssetRequestsCount + openMaintenanceCount;

  useEffect(() => {
    if (isManagerOrAdmin && totalPendingCount > 0) {
      document.title = `● (${totalPendingCount}) Tektalis AMS — Asset Management System`;
    } else {
      document.title = 'Tektalis AMS — Asset Management System';
    }
  }, [isManagerOrAdmin, totalPendingCount]);

  const headerCount = isManagerOrAdmin ? totalPendingCount : 0;
  const pendingLabel =
    headerCount > 0
      ? `${headerCount} pending request${headerCount === 1 ? '' : 's'}`
      : 'No pending requests';

  // TT Suite: the header's sign-out card asks "this device or all devices" and calls the portal;
  // once the server has signed out, this clears AMS's local copy before the card goes to /login.
  const handleSignedOut = () => {
    logout();
  };

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => user && item.roles.includes(user.role),
  );
  const useMoreSheet = visibleNavItems.length > PHONE_BAR_MAX;
  const moreItems = useMoreSheet ? visibleNavItems.slice(PHONE_BAR_SLOTS) : [];
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);
  const moreActive = moreItems.some((item) => location.pathname.startsWith(item.to));

  const getTabPendingCount = (path: string): number => {
    if (path === '/replacements') {
      return pendingReplacementsCount;
    }
    if (path === '/asset-requests') {
      return pendingAssetRequestsCount;
    }
    if (path === '/maintenance') {
      return pendingReplacementsCount + openMaintenanceCount;
    }
    if (path === '/dashboard' && isManagerOrAdmin) {
      return totalPendingCount;
    }
    return 0;
  };

  return (
    <div className={styles.app}>
      {/* Top bar — spans the window; the same 64 px band as every suite app (Kanban's shell). */}
      <header className={styles.topbar}>
        {/* Logo | divider | app name (every suite app's top-bar brand group). */}
        <div className={styles.brandGroup}>
          {/* The suite dashboard: a full page load out of AMS. */}
          <a
            href="/"
            className={styles.brand}
            aria-label="Tektalis dashboard"
            title="Tektalis dashboard"
            data-testid="brand-home"
          >
            <img
              src={`${import.meta.env.BASE_URL}brand/tektalis.svg`}
              alt="Tektalis"
              className={styles.logo}
            />
          </a>
          <span className={styles.brandDivider} aria-hidden="true" />
          <Link to="/dashboard" className={styles.appName} data-testid="app-name">
            Asset Management
          </Link>
        </div>
        {user && (
          <div className={styles.who} data-testid="who">
            {/* TT Suite: Kanban's right-hand group - the app switcher, the envelope (here: pending
                requests), then the shared controls (light/dark | person, sign out). */}
            <AppSwitcher me={portalMe} />
            <Link
              to={isManagerOrAdmin ? '/maintenance' : '/asset-requests'}
              data-testid="header-pending-indicator"
              className={styles.whoAction}
              aria-label={pendingLabel}
              title={pendingLabel}
            >
              <SuiteIcon name="mail" size={20} />
              {headerCount > 0 && (
                <span className={styles.bellCount} aria-hidden="true">
                  {headerCount > 99 ? '99+' : String(headerCount)}
                </span>
              )}
            </Link>
            {/* TT Suite: the same controls as every suite app, in this order. */}
            <SuiteHeaderControls name={user.name} onSignOut={handleSignedOut} onPortalMe={setPortalMe} />
          </div>
        )}
      </header>

      {/* Nav — 256 px side nav (desktop), 72 px icon rail (tablet), bottom bar (phone). */}
      <nav className={styles.nav} aria-label="Main Navigation" data-testid="nav">
        <p className={styles.navHeading}>Navigation</p>
        {visibleNavItems.map((item, index) => {
          const badgeCount = getTabPendingCount(item.to);
          const slug = item.to.replace('/', '') || 'dashboard';
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={
                useMoreSheet && index >= PHONE_BAR_SLOTS
                  ? `${styles.item} ${styles.inMore}`
                  : styles.item
              }
              title={item.label}
            >
              {Icon === HomeIcon ? (
                <HomeIcon className={styles.icon} size={22} />
              ) : (
                <LucideGlyph
                  icon={Icon as LucideIcon}
                  className={styles.icon}
                />
              )}
              <span className={styles.label}>{item.label}</span>
              {badgeCount > 0 && (
                <span
                  data-testid={`nav-dot-${slug}`}
                  title={`${badgeCount} pending item${badgeCount === 1 ? '' : 's'}`}
                  className={styles.dot}
                >
                  <span className={styles.pulse} aria-hidden="true">
                    <span />
                    <span />
                  </span>
                  <span className={styles.dotCount}>{badgeCount}</span>
                </span>
              )}
            </NavLink>
          );
        })}
        {useMoreSheet && (
          <button
            type="button"
            className={`${styles.item} ${styles.moreButton}`}
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-current={moreActive ? 'page' : undefined}
            title="More"
            data-testid="nav-more"
          >
            <LucideGlyph icon={MoreHorizontal} className={styles.icon} />
            <span className={styles.label}>More</span>
            {moreItems.some((item) => getTabPendingCount(item.to) > 0) && (
              <span className={styles.dot} aria-hidden="true">
                <span className={styles.pulse}>
                  <span />
                  <span />
                </span>
              </span>
            )}
          </button>
        )}
      </nav>
      {moreOpen && (
        <MoreSheet items={moreItems} onClose={() => setMoreOpen(false)} badgeFor={getTabPendingCount} />
      )}

      {/* Main — the only region that scrolls. */}
      <main className={styles.main} id="main">
        <Outlet />
      </main>
    </div>
  );
};
