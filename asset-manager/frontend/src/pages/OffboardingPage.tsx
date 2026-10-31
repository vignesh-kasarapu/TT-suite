import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CornerDownLeft,
  Search,
  ShieldAlert,
  Tag,
  UserCheck,
  X,
} from 'lucide-react';
import { listUserAssetsApi, returnAssetApi } from '../api/assignments';
import { extractErrorMessage } from '../api/client';
import { listUserDirectoryApi } from '../api/users';
import type { AssignedAsset, ReturnReason, User } from '../types';

export const OffboardingPage: React.FC = () => {
  const [employees, setEmployees] = useState<User[]>([]);
  const [search, setSearch] = useState<string>('');
  const [selectedEmployee, setSelectedEmployee] = useState<User | null>(null);
  const [heldAssets, setHeldAssets] = useState<AssignedAsset[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState<boolean>(true);
  const [isLoadingAssets, setIsLoadingAssets] = useState<boolean>(false);

  const [toastError, setToastError] = useState<string | null>(null);
  const [toastSuccess, setToastSuccess] = useState<string | null>(null);

  // Return Held Asset Modal state
  const [returningAsset, setReturningAsset] = useState<AssignedAsset | null>(null);
  const [returnReason, setReturnReason] = useState<ReturnReason>('EMPLOYEE_LEFT');
  const [returnedOnDate, setReturnedOnDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [returnMaintDescription, setReturnMaintDescription] = useState<string>('');
  const [returnModalError, setReturnModalError] = useState<string | null>(null);
  const [isReturning, setIsReturning] = useState<boolean>(false);

  const fetchDirectory = useCallback(async () => {
    setIsLoadingEmployees(true);
    try {
      const list = await listUserDirectoryApi(false);
      setEmployees(list);
      setSelectedEmployee((prev) => {
        if (prev) {
          return list.find((u) => u.id === prev.id) ?? list[0] ?? null;
        }
        return list[0] ?? null;
      });
    } catch (err) {
      setToastError(extractErrorMessage(err, 'Failed to load employee directory'));
    } finally {
      setIsLoadingEmployees(false);
    }
  }, []);

  const fetchHeldAssets = useCallback(async (employeeId: number) => {
    setIsLoadingAssets(true);
    try {
      const data = await listUserAssetsApi(employeeId);
      setHeldAssets(data);
    } catch (err) {
      setToastError(extractErrorMessage(err, 'Failed to load held assets'));
    } finally {
      setIsLoadingAssets(false);
    }
  }, []);

  useEffect(() => {
    fetchDirectory();
  }, [fetchDirectory]);

  useEffect(() => {
    if (selectedEmployee) {
      fetchHeldAssets(selectedEmployee.id);
    } else {
      setHeldAssets([]);
    }
  }, [selectedEmployee, fetchHeldAssets]);

  const filteredEmployees = employees.filter((u) => {
    if (!search.trim()) return true;
    const term = search.trim().toLowerCase();
    return (
      u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)
    );
  });

  const openReturnModal = (asset: AssignedAsset) => {
    setReturningAsset(asset);
    setReturnReason('EMPLOYEE_LEFT');
    setReturnedOnDate(new Date().toISOString().slice(0, 10));
    setReturnMaintDescription('');
    setReturnModalError(null);
  };

  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returningAsset || !selectedEmployee) return;
    setReturnModalError(null);

    const toMaintenance = returnReason === 'IN_MAINTENANCE';
    if (toMaintenance && !returnMaintDescription.trim()) {
      setReturnModalError('Please enter the reason for maintenance');
      return;
    }
    const nextStatus = toMaintenance ? 'IN_MAINTENANCE' : 'AVAILABLE';

    setIsReturning(true);
    try {
      await returnAssetApi(returningAsset.id, {
        next_status: nextStatus,
        return_reason: returnReason,
        returned_on: returnedOnDate || undefined,
        description: toMaintenance ? returnMaintDescription.trim() : undefined,
      });
      setReturningAsset(null);
      setToastError(null);
      setToastSuccess(
        toMaintenance
          ? `Returned ${returningAsset.tag} from ${selectedEmployee.name} to maintenance`
          : `Returned ${returningAsset.tag} from ${selectedEmployee.name} (now AVAILABLE)`,
      );
      await Promise.all([
        fetchDirectory(),
        fetchHeldAssets(selectedEmployee.id),
      ]);
    } catch (err) {
      setToastError(extractErrorMessage(err, 'Failed to return asset'));
    } finally {
      setIsReturning(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          Employee Offboarding & Held Assets Check
        </h2>
        <p className="text-sm text-slate-600 mt-0.5">
          Inspect assets held by an employee and record returns before the global admin removes their access
        </p>
      </div>

      {/* Toast Banners */}
      {toastError && (
        <div
          role="alert"
          data-testid="toast-error"
          className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between gap-3 text-sm text-red-700"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{toastError}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastError(null)}
            className="text-red-500 hover:text-red-700 cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {toastSuccess && (
        <div
          role="status"
          data-testid="toast-success"
          className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-sm text-emerald-700"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toastSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastSuccess(null)}
            className="text-emerald-600 hover:text-emerald-800 cursor-pointer"
            aria-label="Dismiss success"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Employee Directory */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h3 className="text-sm font-bold text-slate-900 mb-2">
              Select Employee ({filteredEmployees.length})
            </h3>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Search employee directory"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-200 max-h-[520px] overflow-y-auto">
            {isLoadingEmployees ? (
              <div className="p-6 text-center text-xs text-slate-600">
                Loading employees...
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-600">
                No employees match your search.
              </div>
            ) : (
              filteredEmployees.map((emp) => {
                const isSelected = selectedEmployee?.id === emp.id;
                const count = emp.active_assets_count ?? 0;
                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => setSelectedEmployee(emp)}
                    className={`w-full text-left p-4 transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                      isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {emp.name}
                      </p>
                      <p className="text-xs text-slate-600 truncate">{emp.email}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {count > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          {count} Held
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          0 Held
                        </span>
                      )}
                      {!emp.active && (
                        <span className="text-[11px] text-slate-500">Deactivated</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Selected Employee Held Assets & Offboarding Readiness */}
        <div className="lg:col-span-2 space-y-4">
          {selectedEmployee ? (
            <>
              {/* Offboarding Status Card */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-lg font-bold text-slate-900">
                      {selectedEmployee.name}
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-300 font-semibold">
                      {selectedEmployee.role}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {selectedEmployee.email}
                  </p>

                  <div className="mt-3">
                    {heldAssets.length === 0 ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                        <UserCheck className="w-4 h-4" />
                        Ready for Offboarding — 0 Active Assets Held
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold">
                        <ShieldAlert className="w-4 h-4" />
                        Offboarding Blocked — Holds {heldAssets.length} Active Asset(s)
                      </span>
                    )}
                  </div>
                </div>

                <p
                  data-testid="offboarding-deactivation-note"
                  className="max-w-xs text-xs text-slate-600"
                >
                  Accounts are deactivated by the global admin in the TT Suite portal. The
                  portal refuses it while this person still holds assets.
                </p>
              </div>

              {/* Held Assets Table */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-900">
                    Currently Held Assets ({heldAssets.length})
                  </h4>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th className="py-3 px-4 whitespace-nowrap">Asset ID</th>
                        <th className="py-3 px-4 whitespace-nowrap">Asset Tag</th>
                        <th className="py-3 px-4 whitespace-nowrap">Service Tag</th>
                        <th className="py-3 px-4 whitespace-nowrap">Asset Name</th>
                        <th className="py-3 px-4 whitespace-nowrap">Serial No.</th>
                        <th className="py-3 px-4 whitespace-nowrap">Assigned On</th>
                        <th className="py-3 px-4 whitespace-nowrap text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {isLoadingAssets ? (
                        <tr>
                          <td colSpan={7} className="py-10 text-center text-slate-600">
                            Loading held assets...
                          </td>
                        </tr>
                      ) : heldAssets.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-10 text-center text-slate-600">
                            No active assets are currently held by {selectedEmployee.name}.
                          </td>
                        </tr>
                      ) : (
                        heldAssets.map((asset) => (
                          <tr key={asset.assignment_id} className="hover:bg-slate-50/80">
                            <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-blue-600">
                                <Tag className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                                {asset.tag}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 align-middle whitespace-nowrap font-mono text-xs text-slate-700">
                              {asset.asset_tag || '—'}
                            </td>
                            <td className="py-3.5 px-4 align-middle whitespace-nowrap font-mono text-xs text-slate-700">
                              {asset.service_tag || '—'}
                            </td>
                            <td className="py-3.5 px-4 align-middle whitespace-nowrap font-medium text-slate-900">
                              {asset.name}
                            </td>
                            <td className="py-3.5 px-4 align-middle whitespace-nowrap font-mono text-xs text-slate-600">
                              {asset.serial_no}
                            </td>
                            <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600 tabular-nums">
                              {asset.assigned_on}
                            </td>
                            <td className="py-3.5 px-4 align-middle text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => openReturnModal(asset)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white transition-colors cursor-pointer"
                              >
                                <CornerDownLeft className="w-3.5 h-3.5" />
                                <span>Return Asset</span>
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-600">
              Select an employee from the directory to inspect their held assets.
            </div>
          )}
        </div>
      </div>

      {/* Return Held Asset Modal */}
      {returningAsset && (
        <div
          className="ams-modal fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="offboard-return-modal-title"
        >
          <div className="ams-modal-panel bg-white border border-slate-200 rounded-xl shadow-lg max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <CornerDownLeft className="w-5 h-5 text-blue-600" />
                <h3
                  id="offboard-return-modal-title"
                  className="text-base font-bold text-slate-900"
                >
                  Return Held Asset — {returningAsset.tag}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReturningAsset(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close return modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmReturn} className="p-6 space-y-4" noValidate>
              {returnModalError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
                >
                  {returnModalError}
                </div>
              )}

              <div>
                <label
                  htmlFor="offboard-return-reason"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Return Reason
                </label>
                <select
                  id="offboard-return-reason"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value as ReturnReason)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="EMPLOYEE_LEFT">EMPLOYEE_LEFT (Offboarding)</option>
                  <option value="REPLACEMENT">REPLACEMENT</option>
                  <option value="OTHER">OTHER (Back to AVAILABLE)</option>
                  <option value="IN_MAINTENANCE">IN_MAINTENANCE (Needs Repair)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="offboard-return-date"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Return Date
                </label>
                <input
                  id="offboard-return-date"
                  type="date"
                  value={returnedOnDate}
                  onChange={(e) => setReturnedOnDate(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {returnReason === 'IN_MAINTENANCE' && (
                <div>
                  <label
                    htmlFor="offboard-maint-desc"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Reason for Maintenance *
                  </label>
                  <textarea
                    id="offboard-maint-desc"
                    rows={3}
                    value={returnMaintDescription}
                    onChange={(e) => setReturnMaintDescription(e.target.value)}
                    placeholder="Describe why this asset needs maintenance..."
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setReturningAsset(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isReturning}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {isReturning ? 'Returning...' : 'Confirm Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
