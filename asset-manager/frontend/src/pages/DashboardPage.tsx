import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Download,
  Laptop,
  Package,
  RefreshCw,
  Upload,
  Users,
} from 'lucide-react';
import { listAssetsApi } from '../api/assets';
import { listMyAssetsApi } from '../api/assignments';
import { listCategoriesApi } from '../api/categories';
import { listMaintenanceRecordsApi } from '../api/maintenance';
import { listReplacementRequestsApi } from '../api/replacements';
import {
  downloadAssetsCsvApi,
  getReportsSummaryApi,
  triggerCsvFileDownload,
} from '../api/reports';
import { listUserDirectoryApi } from '../api/users';
import {
  BulkImportModal,
  DATA_IMPORTED_EVENT,
} from '../components/BulkImportModal';
import { getRoleBadgeClasses } from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import type {
  AssignedAsset,
  Category,
  MaintenanceRecord,
  ReplacementRequest,
  ReportsSummaryResponse,
  User,
} from '../types';

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const isManagerOrAdmin =
    user?.role === 'ADMIN' || user?.role === 'ASSET_MANAGER';

  const [myAssets, setMyAssets] = useState<AssignedAsset[]>([]);
  const [requests, setRequests] = useState<ReplacementRequest[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [totalAssetsCount, setTotalAssetsCount] = useState<number>(0);
  const [reportsSummary, setReportsSummary] =
    useState<ReportsSummaryResponse | null>(null);
  const [directoryUsers, setDirectoryUsers] = useState<User[]>([]);
  const [openMaintenance, setOpenMaintenance] = useState<MaintenanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDownloadingCsv, setIsDownloadingCsv] = useState<boolean>(false);
  const [isImportOpen, setIsImportOpen] = useState<boolean>(false);

  const fetchDashboardSummary = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const [heldData, reqData] = await Promise.all([
        listMyAssetsApi().catch(() => [] as AssignedAsset[]),
        listReplacementRequestsApi().catch(() => [] as ReplacementRequest[]),
      ]);
      setMyAssets(heldData);
      setRequests(reqData);

      if (user.role === 'ADMIN' || user.role === 'ASSET_MANAGER') {
        const [catData, assetsRes, usersRes, maintRes, summaryRes] =
          await Promise.all([
            listCategoriesApi().catch(() => [] as Category[]),
            listAssetsApi({ page: 1, size: 1 }).catch(() => ({
              items: [],
              total: 0,
              page: 1,
              size: 1,
              pages: 1,
            })),
            listUserDirectoryApi().catch(() => [] as User[]),
            listMaintenanceRecordsApi({ open_only: true }).catch(
              () => [] as MaintenanceRecord[],
            ),
            getReportsSummaryApi().catch(() => null),
          ]);
        setCategories(catData);
        setTotalAssetsCount(assetsRes.total);
        setDirectoryUsers(usersRes);
        setOpenMaintenance(maintRes);
        setReportsSummary(summaryRes);
      } else {
        setCategories([]);
        setTotalAssetsCount(0);
        setDirectoryUsers([]);
        setOpenMaintenance([]);
        setReportsSummary(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchDashboardSummary();
  }, [fetchDashboardSummary]);

  useEffect(() => {
    const handleImported = () => {
      fetchDashboardSummary();
    };
    window.addEventListener(DATA_IMPORTED_EVENT, handleImported);
    return () => {
      window.removeEventListener(DATA_IMPORTED_EVENT, handleImported);
    };
  }, [fetchDashboardSummary]);

  const handleDownloadCsv = async () => {
    setIsDownloadingCsv(true);
    try {
      const blob = await downloadAssetsCsvApi();
      triggerCsvFileDownload(blob, 'assets_report.csv');
    } finally {
      setIsDownloadingCsv(false);
    }
  };

  if (!user) {
    return null;
  }

  // Request status counts (own requests for EMPLOYEE, all requests for ASSET_MANAGER/ADMIN)
  const pendingRequests = requests.filter((r) => r.status === 'PENDING').length;
  const onHoldRequests = requests.filter((r) => r.status === 'ON_HOLD').length;
  const openReviewRequests = pendingRequests + onHoldRequests;
  const approvedRequests = requests.filter((r) => r.status === 'APPROVED').length;
  const completedRequests = requests.filter((r) => r.status === 'COMPLETED').length;
  const rejectedRequests = requests.filter((r) => r.status === 'REJECTED').length;

  const totalCatalogAssets = isManagerOrAdmin
    ? reportsSummary?.total_assets ?? totalAssetsCount
    : categories.reduce((sum, c) => sum + (c.total_assets ?? 0), 0);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Welcome Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              Welcome back, {user.name}
            </h2>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${getRoleBadgeClasses(
                user.role,
              )}`}
            >
              {user.role}
            </span>
          </div>
          <p className="text-sm text-slate-600">
            Overview of your assets, requests, and inventory
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2.5">
          <button
            type="button"
            onClick={fetchDashboardSummary}
            className="inline-flex items-center justify-center sm:justify-start text-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-xs cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-blue-600" />
            <span>Refresh</span>
          </button>

          {isManagerOrAdmin && (
            <>
              <button
                type="button"
                data-testid="dashboard-import-btn"
                onClick={() => setIsImportOpen(true)}
                className="inline-flex items-center justify-center sm:justify-start text-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-semibold transition-colors shadow-xs cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Import Assets</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadCsv}
                disabled={isDownloadingCsv}
                className="inline-flex items-center justify-center sm:justify-start text-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-sm font-semibold transition-colors shadow-xs cursor-pointer"
              >
                <Download className="w-4 h-4 text-blue-600" />
                <span>
                  {isDownloadingCsv ? 'Exporting...' : 'Download CSV Report'}
                </span>
              </button>

              <Link
                to="/reports"
                className="inline-flex items-center justify-center sm:justify-start text-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors shadow-xs"
              >
                <BarChart3 className="w-4 h-4 text-blue-600" />
                <span>Reports</span>
              </Link>

              <Link
                to="/assets"
                className="inline-flex items-center justify-center sm:justify-start text-center gap-2 px-3 sm:px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors shadow-xs"
              >
                <Package className="w-4 h-4" />
                <span>Asset Register</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </>
          )}
          {user.role === 'ADMIN' && (
            <Link
              to="/users"
              className="inline-flex items-center justify-center sm:justify-start text-center gap-2 px-3 sm:px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors shadow-xs"
            >
              <Users className="w-4 h-4" />
              <span>Manage Users</span>
            </Link>
          )}
        </div>
      </div>

      {/* Top KPI Summary Cards */}
      <div
        className={`grid grid-cols-2 gap-3 sm:gap-4 ${
          isManagerOrAdmin ? 'lg:grid-cols-4' : ''
        }`}
      >
        {/* Card 1: My Assigned Assets */}
        <Link
          to="/my-assets"
          className="bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-3 sm:p-5 shadow-xs transition-colors flex items-center justify-between"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal sm:tracking-wider text-slate-500">
              My Assigned Assets
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
              {isLoading ? '...' : myAssets.length}
            </p>
            <p className="text-xs text-blue-600 font-medium mt-1">
              View held hardware &rarr;
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 hidden sm:flex items-center justify-center text-blue-600">
            <Laptop className="w-5 h-5" />
          </div>
        </Link>

        {/* Card 2: Replacement Requests / Maintenance Log */}
        <Link
          to={isManagerOrAdmin ? '/maintenance' : '/replacements'}
          className="bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-3 sm:p-5 shadow-xs transition-colors flex items-center justify-between"
        >
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-normal sm:tracking-wider text-slate-500">
                {isManagerOrAdmin ? 'Maintenance Log Queue' : 'My Replacement Requests'}
              </p>
              {openReviewRequests > 0 && (
                <span
                  data-testid="dashboard-pending-replacements-dot"
                  className="relative flex h-2.5 w-2.5"
                  title={`${openReviewRequests} open request(s) (${pendingRequests} pending, ${onHoldRequests} on hold)`}
                >
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600" />
                </span>
              )}
            </div>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
              {isLoading ? '...' : requests.length}
            </p>
            <p className="text-xs text-blue-700 font-medium mt-1">
              {openReviewRequests} open for review &rarr;
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 hidden sm:flex items-center justify-center text-blue-600">
            <ArrowLeftRight className="w-5 h-5" />
          </div>
        </Link>

        {isManagerOrAdmin && (
          <>
            {/* Card 3: Assets + Categories counts (detail lives on Categories / Assets tabs) */}
            <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-5 shadow-xs flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-3">
                <Link to="/assets" className="block group">
                  <p className="text-xs font-semibold uppercase tracking-normal sm:tracking-wider text-slate-500">
                    Assets
                  </p>
                  <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-0.5 group-hover:text-blue-700">
                    {isLoading ? '...' : totalCatalogAssets}
                  </p>
                </Link>
                <Link to="/categories" className="block group">
                  <p className="text-xs font-semibold uppercase tracking-normal sm:tracking-wider text-slate-500">
                    Categories
                  </p>
                  <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-0.5 group-hover:text-blue-700">
                    {isLoading ? '...' : categories.length}
                  </p>
                </Link>
              </div>
              <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 hidden sm:flex items-center justify-center text-emerald-700 shrink-0">
                <Package className="w-5 h-5" />
              </div>
            </div>

            {/* Card 4: Users / Active Repairs */}
            <Link
              to="/maintenance"
              className="bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-3 sm:p-5 shadow-xs transition-colors flex items-center justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-normal sm:tracking-wider text-slate-500">
                    Users &amp; Open Repairs
                  </p>
                  {openMaintenance.length > 0 && (
                    <span
                      data-testid="dashboard-open-maintenance-dot"
                      className="relative flex h-2.5 w-2.5"
                      title={`${openMaintenance.length} open maintenance record(s)`}
                    >
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600" />
                    </span>
                  )}
                </div>
                <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
                  {isLoading ? '...' : `${directoryUsers.length} Users`}
                </p>
                <p className="text-xs text-blue-600 font-medium mt-1">
                  {openMaintenance.length} open maintenance log
                  {openMaintenance.length === 1 ? '' : 's'} &rarr;
                </p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-cyan-50 border border-cyan-200 hidden sm:flex items-center justify-center text-cyan-600">
                <Users className="w-5 h-5" />
              </div>
            </Link>
          </>
        )}
      </div>

      {/* Replacement Requests Breakdown */}
      <div className="grid grid-cols-1 gap-6 max-w-xl">
        {/* Replacement Requests Summary Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-semibold text-slate-900">
                  {isManagerOrAdmin
                    ? 'Replacement Requests'
                    : 'My Replacement Requests'}
                </h3>
              </div>
              <Link
                to={isManagerOrAdmin ? '/maintenance' : '/replacements'}
                className="inline-flex items-center min-h-10 sm:min-h-0 px-2 -mx-2 text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Open &rarr;
              </Link>
            </div>
            <p className="text-xs text-slate-600 mb-4">
              Live status breakdown of replacement requests and temporary loaner repairs:
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-amber-50/60 border border-amber-200">
                <span className="text-xs font-semibold text-amber-700">PENDING</span>
                <p className="text-xl font-bold text-slate-900 mt-1">
                  {pendingRequests}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-orange-50/60 border border-orange-200">
                <span className="text-xs font-semibold text-orange-800">ON HOLD</span>
                <p className="text-xl font-bold text-slate-900 mt-1">
                  {onHoldRequests}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-200">
                <span className="text-xs font-semibold text-blue-700">APPROVED</span>
                <p className="text-xl font-bold text-slate-900 mt-1">
                  {approvedRequests}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-200">
                <span className="text-xs font-semibold text-emerald-700">COMPLETED</span>
                <p className="text-xl font-bold text-slate-900 mt-1">
                  {completedRequests}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 col-span-2">
                <span className="text-xs font-semibold text-slate-600">REJECTED</span>
                <p className="text-xl font-bold text-slate-900 mt-1">
                  {rejectedRequests}
                </p>
              </div>
            </div>
          </div>

          {requests.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-semibold uppercase tracking-normal sm:tracking-wider text-slate-500 mb-2">
                Latest Request
              </p>
              <div className="flex items-center justify-between text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <div>
                  <span className="font-mono font-semibold text-blue-600">
                    #{requests[0].id} &bull; {requests[0].asset_tag ?? `Asset #${requests[0].asset_id}`}
                  </span>
                  <span className="text-slate-600 ml-1.5">
                    ({requests[0].old_asset_action})
                  </span>
                </div>
                <span className="font-semibold text-slate-900">
                  {requests[0].status}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {isManagerOrAdmin && user && (
        <BulkImportModal
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          userRole={user.role}
          allowedTabs={['assets']}
          initialTab="assets"
          onImportSuccess={() => {
            fetchDashboardSummary();
          }}
        />
      )}
    </div>
  );
};
