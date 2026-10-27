import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight,
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  FolderOpen,
  Laptop,
  Package,
  Users,
  Wrench,
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
        {visibleNavItems.map((item) => {
          const badgeCount = getTabPendingCount(item.to);
          const slug = item.to.replace('/', '') || 'dashboard';
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={styles.item}
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
      </nav>

      {/* Main — the only region that scrolls. */}
      <main className={styles.main} id="main">
        <Outlet />
      </main>
    </div>
  );
};
