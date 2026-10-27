import React, { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight,
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  FolderOpen,
  Laptop,
  LayoutDashboard,
  LogOut,
  Package,
  ShieldCheck,
  User as UserIcon,
  Users,
  Wrench,
} from 'lucide-react';
import { listAssetRequestsApi } from '../api/assetRequests';
import { AppSwitcher } from './AppSwitcher';
import { SuiteHeaderControls } from './SuiteHeaderControls';
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

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Workspace Overview',
    to: '/dashboard',
    icon: <LayoutDashboard className="w-4 h-4" />,
    roles: ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE'],
  },
  {
    label: 'My Assets',
    to: '/my-assets',
    icon: <Laptop className="w-4 h-4" />,
    roles: ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE'],
  },
  {
    label: 'Replacement Requests',
    to: '/replacements',
    icon: <ArrowLeftRight className="w-4 h-4" />,
    roles: ['EMPLOYEE'],
  },
  {
    label: 'Asset Requests',
    to: '/asset-requests',
    icon: <ClipboardList className="w-4 h-4" />,
    roles: ['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE'],
  },
  {
    label: 'Asset Register',
    to: '/assets',
    icon: <Package className="w-4 h-4" />,
    roles: ['ADMIN', 'ASSET_MANAGER'],
  },
  {
    label: 'Categories',
    to: '/categories',
    icon: <FolderOpen className="w-4 h-4" />,
    roles: ['ADMIN', 'ASSET_MANAGER'],
  },
  {
    label: 'Maintenance Log',
    to: '/maintenance',
    icon: <Wrench className="w-4 h-4" />,
    roles: ['ADMIN', 'ASSET_MANAGER'],
  },
  {
    label: 'Employee Offboarding',
    to: '/offboarding',
    icon: <ClipboardCheck className="w-4 h-4" />,
    roles: ['ADMIN', 'ASSET_MANAGER'],
  },
  {
    label: 'Reports & Export',
    to: '/reports',
    icon: <BarChart3 className="w-4 h-4" />,
    roles: ['ADMIN', 'ASSET_MANAGER'],
  },
  {
    label: 'User Management',
    to: '/users',
    icon: <Users className="w-4 h-4" />,
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

  // TT Suite: the portal's sign-out page asks "this device or all devices".
  const handleLogout = () => {
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
    <div
      className="h-screen overflow-hidden flex"
      // TT Suite: the preset's canvas (index.css --ams-canvas), so it follows light/dark too.
      style={{
        backgroundColor: 'var(--color-bg)',
        backgroundImage: 'var(--ams-canvas)',
      }}
    >
      {/* Sidebar — fixed to viewport; does not scroll with page content */}
      <aside className="w-64 h-screen sticky top-0 bg-white border-r border-slate-200 border-b-4 border-b-blue-600 flex flex-col justify-between shrink-0 shadow-xs overflow-y-auto">
        <div>
          {/* Brand Header with Official Tektalis Logo */}
          <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between gap-2">
            <a href="/" className="flex flex-col justify-center" aria-label="Tektalis dashboard" title="Tektalis dashboard" data-testid="brand-home">
              <img
                src={`${import.meta.env.BASE_URL}tektalis-logo.png`}
                alt="Tektalis"
                className="h-7 w-auto object-contain object-left"
              />
              <span className="text-[11px] text-blue-600 font-semibold tracking-tight mt-0.5">
                Asset Manager
              </span>
            </a>
            <AppSwitcher />
          </div>

          {/* Navigation */}
          <div className="p-4">
            <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Navigation
            </p>
            <nav className="space-y-1" aria-label="Main Navigation">
              {visibleNavItems.map((item) => {
                const badgeCount = getTabPendingCount(item.to);
                const hasPendingDot = badgeCount > 0;
                const slug = item.to.replace('/', '') || 'dashboard';

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-blue-50/60 hover:text-slate-900'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div className="flex items-center gap-3 min-w-0">
                          {item.icon}
                          <span className="truncate">{item.label}</span>
                        </div>

                        {hasPendingDot && (
                          <span
                            data-testid={`nav-dot-${slug}`}
                            title={`${badgeCount} pending item${badgeCount === 1 ? '' : 's'}`}
                            className="inline-flex items-center gap-1.5 shrink-0"
                          >
                            <span className="relative flex h-2.5 w-2.5">
                              <span
                                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                                  isActive ? 'bg-white' : 'bg-blue-500'
                                }`}
                              />
                              <span
                                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                                  isActive ? 'bg-white' : 'bg-blue-600'
                                }`}
                              />
                            </span>
                            <span
                              className={`text-[11px] font-bold px-1.5 py-0.2 rounded-full ${
                                isActive
                                  ? 'bg-white/20 text-white'
                                  : 'bg-blue-50 text-blue-700 border border-blue-200'
                              }`}
                            >
                              {badgeCount}
                            </span>
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </nav>
          </div>
        </div>

        {/* User Footer Card */}
        {user && (
          <div className="p-4 border-t border-slate-200 bg-white space-y-2">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 mb-1">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {user.name}
                </p>
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
              </div>
              <p className="text-xs text-slate-600 truncate mb-2">{user.email}</p>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${getRoleBadgeClasses(
                  user.role,
                )}`}
              >
                {user.role}
              </span>
            </div>

            {/* TT Suite: the profile (name, photo, theme) lives in the portal; a full page load. */}
            <a
              href="/profile"
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors border border-slate-200 bg-white text-slate-700 hover:bg-blue-50/60 hover:text-slate-900"
            >
              <UserIcon className="w-4 h-4" />
              <span>My Profile</span>
            </a>

            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-blue-50/60 hover:text-slate-900 text-sm font-medium transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Top Bar */}
        <header className="h-16 shrink-0 bg-white border-b border-slate-200 border-t-3 border-t-blue-600 px-8 gap-4 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-base font-semibold text-slate-900 truncate">
              Enterprise Asset Management System
            </h1>
          </div>
          {user && (
            <div className="flex items-center gap-3">
              {isManagerOrAdmin && totalPendingCount > 0 && (
                <Link
                  to="/maintenance"
                  data-testid="header-pending-indicator"
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 hover:bg-blue-100 border border-blue-200 text-xs font-semibold text-blue-700 transition-colors"
                  title={`${pendingReplacementsCount} pending replacement request(s), ${openMaintenanceCount} open maintenance record(s)`}
                >
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600" />
                  </span>
                  <span>
                    {pendingReplacementsCount > 0
                      ? `${pendingReplacementsCount} Pending Request${
                          pendingReplacementsCount === 1 ? '' : 's'
                        }`
                      : `${openMaintenanceCount} Open Repair${
                          openMaintenanceCount === 1 ? '' : 's'
                        }`}
                  </span>
                </Link>
              )}

              {/* TT Suite: the same four controls as every suite app, in this order. */}
              <SuiteHeaderControls name={user.name} onSignOut={handleLogout} />
            </div>
          )}
        </header>

        {/* Page Container — only this region scrolls */}
        <main className="flex-1 min-h-0 p-8 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
