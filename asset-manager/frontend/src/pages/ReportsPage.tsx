import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Laptop,
  Package,
  RefreshCw,
  Users,
  Wrench,
  Archive,
  Tag,
} from 'lucide-react';
import { extractErrorMessage } from '../api/client';
import { listUserAssetsApi } from '../api/assignments';
import {
  downloadAssetsCsvApi,
  downloadAssetsPdfApi,
  getReportsSummaryApi,
  triggerFileDownload,
} from '../api/reports';
import { listUserDirectoryApi } from '../api/users';
import type {
  AssetStatus,
  AssignedAsset,
  ReportsSummaryResponse,
  User,
} from '../types';

export const ReportsPage: React.FC = () => {
  const [summary, setSummary] = useState<ReportsSummaryResponse | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('');
  const [employeeAssets, setEmployeeAssets] = useState<AssignedAsset[]>([]);
  const [isLoadingEmployeeAssets, setIsLoadingEmployeeAssets] =
    useState<boolean>(false);

  const [csvStatusFilter, setCsvStatusFilter] = useState<AssetStatus | ''>('');
  const [csvCategoryFilter, setCsvCategoryFilter] = useState<number | ''>('');
  const [isDownloadingCsv, setIsDownloadingCsv] = useState<boolean>(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchReportsData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [summaryRes, directoryRes] = await Promise.all([
        getReportsSummaryApi(),
        listUserDirectoryApi().catch(() => [] as User[]),
      ]);
      setSummary(summaryRes);
      setUsers(directoryRes);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReportsData();
  }, [fetchReportsData]);

  const handleSelectEmployee = async (userIdValue: string) => {
    const parsedId = userIdValue ? Number(userIdValue) : '';
    setSelectedUserId(parsedId);
    if (!parsedId) {
      setEmployeeAssets([]);
      return;
    }

    setIsLoadingEmployeeAssets(true);
    try {
      const held = await listUserAssetsApi(parsedId);
      setEmployeeAssets(held);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoadingEmployeeAssets(false);
    }
  };

  const exportFilters = () => ({
    status: csvStatusFilter,
    category_id: csvCategoryFilter,
  });

  const handleDownloadCsv = async () => {
    setIsDownloadingCsv(true);
    setError(null);
    try {
      const blob = await downloadAssetsCsvApi(exportFilters());
      triggerFileDownload(blob, 'assets_report.csv');
      setToastMessage('Asset register CSV report downloaded (assets_report.csv).');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsDownloadingCsv(false);
    }
  };

  const handleDownloadPdf = async () => {
    setIsDownloadingPdf(true);
    setError(null);
    try {
      const blob = await downloadAssetsPdfApi(exportFilters());
      triggerFileDownload(blob, 'assets_report.pdf');
      setToastMessage('Asset register PDF report downloaded (assets_report.pdf).');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const totalAssets = summary?.total_assets ?? 0;
  const totalValue = summary?.total_value ?? 0;
  const availableCount = summary?.by_status?.AVAILABLE ?? 0;
  const assignedCount = summary?.by_status?.ASSIGNED ?? 0;
  const inMaintenanceCount = summary?.by_status?.IN_MAINTENANCE ?? 0;
  const retiredCount = summary?.by_status?.RETIRED ?? 0;
  const categories = summary?.category_breakdown ?? [];

  const pct = (count: number) =>
    totalAssets > 0 ? Math.round((count / totalAssets) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Executive Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            <h2 className="text-xl font-bold text-slate-900">
              Executive Reports &amp; Inventory Analytics
            </h2>
          </div>
          <p className="text-sm text-slate-600">
            Inventory metrics, category breakdown, employee asset lookup, and CSV/PDF export
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Export Status Filter"
            value={csvStatusFilter}
            onChange={(e) =>
              setCsvStatusFilter(e.target.value as AssetStatus | '')
            }
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium"
          >
            <option value="">All Statuses</option>
            <option value="AVAILABLE">AVAILABLE Only</option>
            <option value="ASSIGNED">ASSIGNED Only</option>
            <option value="IN_MAINTENANCE">IN_MAINTENANCE Only</option>
            <option value="RETIRED">RETIRED Only</option>
          </select>

          <select
            aria-label="Export Category Filter"
            value={csvCategoryFilter}
            onChange={(e) =>
              setCsvCategoryFilter(e.target.value ? Number(e.target.value) : '')
            }
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.category_id} value={cat.category_id}>
                {cat.category_name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={fetchReportsData}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-xs cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-blue-600" />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => void handleDownloadCsv()}
            disabled={isDownloadingCsv || isDownloadingPdf}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors shadow-xs cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>
              {isDownloadingCsv ? 'Exporting CSV...' : 'Download CSV'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handleDownloadPdf()}
            disabled={isDownloadingCsv || isDownloadingPdf}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 text-blue-700 text-sm font-semibold transition-colors shadow-xs cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>
              {isDownloadingPdf ? 'Exporting PDF...' : 'Download PDF'}
            </span>
          </button>
        </div>
      </div>

      {/* Banners */}
      {toastMessage && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl flex items-center justify-between text-sm"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-xs font-semibold underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-2 text-sm"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 5 Summary KPI Cards (Total, Available, Assigned, In Maintenance, Retired) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Assets */}
        <div
          data-testid="kpi-total-assets"
          className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Assets
            </span>
            <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900">
            {isLoading ? '...' : totalAssets}
          </p>
          <p className="text-xs text-slate-600 mt-1">
            Valuation:{' '}
            <strong className="text-slate-900">
              ₹{totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
          </p>
        </div>

        {/* Available */}
        <div
          data-testid="kpi-available-assets"
          className="bg-white border border-emerald-200 rounded-xl p-5 shadow-xs"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
              AVAILABLE
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900">
            {isLoading ? '...' : availableCount}
          </p>
          <p className="text-xs text-emerald-700 font-medium mt-1">
            {pct(availableCount)}% of fleet ready
          </p>
        </div>

        {/* Assigned */}
        <div
          data-testid="kpi-assigned-assets"
          className="bg-white border border-blue-200 rounded-xl p-5 shadow-xs"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border bg-blue-50 text-blue-700 border-blue-200">
              ASSIGNED
            </span>
            <Laptop className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900">
            {isLoading ? '...' : assignedCount}
          </p>
          <p className="text-xs text-blue-700 font-medium mt-1">
            {pct(assignedCount)}% active with staff
          </p>
        </div>

        {/* In Maintenance */}
        <div
          data-testid="kpi-maintenance-assets"
          className="bg-white border border-amber-200 rounded-xl p-5 shadow-xs"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-200">
              IN_MAINTENANCE
            </span>
            <Wrench className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900">
            {isLoading ? '...' : inMaintenanceCount}
          </p>
          <p className="text-xs text-amber-700 font-medium mt-1">
            {pct(inMaintenanceCount)}% under repair
          </p>
        </div>

        {/* Retired */}
        <div
          data-testid="kpi-retired-assets"
          className="bg-white border border-slate-300 rounded-xl p-5 shadow-xs"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border bg-slate-100 text-slate-600 border-slate-300">
              RETIRED
            </span>
            <Archive className="w-4 h-4 text-slate-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900">
            {isLoading ? '...' : retiredCount}
          </p>
          <p className="text-xs text-slate-600 font-medium mt-1">
            {pct(retiredCount)}% decommissioned
          </p>
        </div>
      </div>

      {/* Category Breakdown Chart & Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-semibold text-slate-900">
                Asset Breakdown by Category &amp; Status
              </h3>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Inventory and cost distribution across categories
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4 whitespace-nowrap">Category</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">Total</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">Available</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">Assigned</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">In Maintenance</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">Retired</th>
                <th className="py-3 px-4 whitespace-nowrap">Status Distribution Bar</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">Total Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {categories.map((cat) => {
                const catTotal = cat.total || 1;
                const availPct = Math.round((cat.available / catTotal) * 100);
                const assignPct = Math.round((cat.assigned / catTotal) * 100);
                const maintPct = Math.round((cat.in_maintenance / catTotal) * 100);
                const retPct = Math.round((cat.retired / catTotal) * 100);

                return (
                  <tr
                    key={cat.category_id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap font-semibold text-slate-900">
                      {cat.category_name}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap text-right font-bold text-slate-900">
                      {cat.total}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {cat.available}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        {cat.assigned}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        {cat.in_maintenance}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-300">
                        {cat.retired}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 align-middle min-w-44">
                      {cat.total > 0 ? (
                        <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden flex border border-slate-200">
                          <div
                            style={{ width: `${availPct}%` }}
                            className="bg-emerald-500 h-full"
                            title={`Available: ${cat.available}`}
                          />
                          <div
                            style={{ width: `${assignPct}%` }}
                            className="bg-blue-600 h-full"
                            title={`Assigned: ${cat.assigned}`}
                          />
                          <div
                            style={{ width: `${maintPct}%` }}
                            className="bg-amber-500 h-full"
                            title={`In Maintenance: ${cat.in_maintenance}`}
                          />
                          <div
                            style={{ width: `${retPct}%` }}
                            className="bg-slate-400 h-full"
                            title={`Retired: ${cat.retired}`}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">No assets</span>
                      )}
                    </td>
                    <td className="py-3.5 px-6 text-right font-mono font-semibold text-slate-900">
                      ₹
                      {cat.total_value.toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              <h3 className="text-base font-semibold text-slate-900">
                Employee Asset Lookup
              </h3>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              View hardware currently checked out to a specific employee
            </p>
          </div>

          <div className="w-full sm:w-80">
            <select
              aria-label="Select Employee for Asset Report"
              value={selectedUserId}
              onChange={(e) => handleSelectEmployee(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-slate-900 text-sm font-medium"
            >
              <option value="">-- Select an employee --</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email}) — {u.role}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedUserId !== '' && (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            {isLoadingEmployeeAssets ? (
              <div className="p-6 text-center text-sm text-slate-600">
                Loading assigned assets...
              </div>
            ) : employeeAssets.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-600 bg-slate-50">
                No active assets are currently assigned to this user.
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4 whitespace-nowrap">Asset ID</th>
                    <th className="py-3 px-4 whitespace-nowrap">Asset Name</th>
                    <th className="py-3 px-4 whitespace-nowrap">Category</th>
                    <th className="py-3 px-4 whitespace-nowrap">Serial No</th>
                    <th className="py-3 px-4 whitespace-nowrap">Location</th>
                    <th className="py-3 px-4 whitespace-nowrap">Assigned On</th>
                    <th className="py-3 px-4 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {employeeAssets.map((asset) => (
                    <tr key={asset.id} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-blue-600">
                          <Tag className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                          {asset.tag}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap font-medium text-slate-900">
                        {asset.name}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600">
                        {asset.category_name ?? `Category #${asset.category_id}`}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap font-mono text-xs text-slate-600">
                        {asset.serial_no}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600">
                        {asset.location}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600 tabular-nums">
                        {asset.assigned_on}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border bg-blue-50 text-blue-700 border-blue-200">
                          {asset.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
