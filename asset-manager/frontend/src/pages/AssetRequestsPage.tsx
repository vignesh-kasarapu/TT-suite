import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Plus,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import {
  approveAssetRequestApi,
  listAssetRequestsApi,
  listAvailableAssetsForRequestApi,
  rejectAssetRequestApi,
} from '../api/assetRequests';
import { listCategoriesApi } from '../api/categories';
import { extractErrorMessage } from '../api/client';
import { EmployeeAssetRequestModal } from '../components/EmployeeAssetRequestModal';
import { notifyPendingRequestsUpdated } from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import type {
  Asset,
  AssetRequest,
  AssetRequestStatus,
  Category,
} from '../types';

export function getAssetRequestStatusBadgeClasses(status: AssetRequestStatus): string {
  switch (status) {
    case 'PENDING':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'APPROVED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'REJECTED':
    default:
      return 'bg-slate-100 text-slate-600 border-slate-300';
  }
}

export const AssetRequestsPage: React.FC = () => {
  const { user } = useAuth();
  const isEmployee = user?.role === 'EMPLOYEE';
  const isManagerOrAdmin =
    user?.role === 'ADMIN' || user?.role === 'ASSET_MANAGER';

  const [requests, setRequests] = useState<AssetRequest[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toastError, setToastError] = useState<string | null>(null);
  const [toastSuccess, setToastSuccess] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);

  const [approvingReq, setApprovingReq] = useState<AssetRequest | null>(null);
  const [approveCategoryId, setApproveCategoryId] = useState<string>('');
  const [approveComment, setApproveComment] = useState<string>('');
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [hasAvailableStock, setHasAvailableStock] = useState<boolean>(false);
  const [isLoadingStock, setIsLoadingStock] = useState<boolean>(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [approveEmployeeWillRegister, setApproveEmployeeWillRegister] =
    useState<boolean>(true);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState<boolean>(false);

  const [rejectingReq, setRejectingReq] = useState<AssetRequest | null>(null);
  const [rejectComment, setRejectComment] = useState<string>('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [isRejecting, setIsRejecting] = useState<boolean>(false);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    setToastError(null);
    try {
      const data = await listAssetRequestsApi(
        statusFilter ? (statusFilter as AssetRequestStatus) : undefined,
      );
      setRequests(data);
    } catch (err) {
      setToastError(extractErrorMessage(err, 'Failed to load asset requests'));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  const fetchCategories = useCallback(async () => {
    try {
      const cats = await listCategoriesApi();
      setCategories(cats);
    } catch {
      // Categories optional for manager list view
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const loadAvailableStock = useCallback(
    async (req: AssetRequest, categoryOverride?: string) => {
      setIsLoadingStock(true);
      setApproveError(null);
      try {
        const categoryParam =
          categoryOverride !== undefined && categoryOverride !== ''
            ? Number(categoryOverride)
            : req.is_other
              ? undefined
              : req.category_id ?? undefined;
        const stock = await listAvailableAssetsForRequestApi(
          req.id,
          categoryParam,
        );
        setAvailableAssets(stock.items);
        setHasAvailableStock(stock.has_available);
        setSelectedAssetId(
          stock.has_available && stock.items.length > 0
            ? String(stock.items[0].id)
            : '',
        );
      } catch (err) {
        setAvailableAssets([]);
        setHasAvailableStock(false);
        setSelectedAssetId('');
        setApproveError(
          extractErrorMessage(err, 'Failed to check available inventory'),
        );
      } finally {
        setIsLoadingStock(false);
      }
    },
    [],
  );

  const openApproveModal = (req: AssetRequest) => {
    setApprovingReq(req);
    setApproveComment('');
    setApproveEmployeeWillRegister(true);
    setApproveError(null);
    setApproveCategoryId('');
    setAvailableAssets([]);
    setHasAvailableStock(false);
    setSelectedAssetId('');
    void loadAvailableStock(req);
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvingReq) return;
    setApproveError(null);

    if (hasAvailableStock && !selectedAssetId) {
      setApproveError('Select an AVAILABLE asset to assign');
      return;
    }

    setIsApproving(true);
    try {
      const payload: {
        category_id?: number;
        asset_id?: number;
        comment?: string;
        requires_employee_register: boolean;
      } = {
        requires_employee_register: hasAvailableStock
          ? false
          : approveEmployeeWillRegister,
      };
      if (approveComment.trim()) {
        payload.comment = approveComment.trim();
      }
      if (approvingReq.is_other && approveCategoryId) {
        payload.category_id = Number(approveCategoryId);
      }
      if (hasAvailableStock && selectedAssetId) {
        payload.asset_id = Number(selectedAssetId);
      }
      const approved = await approveAssetRequestApi(approvingReq.id, payload);
      setToastSuccess(
        approved.created_asset_id
          ? `Approved request #${approved.id} and assigned ${approved.created_asset_tag} to ${approved.requester_name}.`
          : approveEmployeeWillRegister
            ? `Approved request #${approved.id}. No stock — ${approved.requester_name} will be reminded to register.`
            : `Approved request #${approved.id}. No stock — register the asset yourself when it arrives.`,
      );
      setApprovingReq(null);
      notifyPendingRequestsUpdated();
      await fetchRequests();
    } catch (err) {
      setApproveError(extractErrorMessage(err, 'Failed to approve asset request'));
    } finally {
      setIsApproving(false);
    }
  };

  const openRejectModal = (req: AssetRequest) => {
    setRejectingReq(req);
    setRejectComment('');
    setRejectError(null);
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingReq) return;
    if (!rejectComment.trim()) {
      setRejectError('A rejection comment is required');
      return;
    }
    setIsRejecting(true);
    setRejectError(null);
    try {
      const rejected = await rejectAssetRequestApi(rejectingReq.id, {
        comment: rejectComment.trim(),
      });
      setToastSuccess(`Rejected asset request #${rejected.id}`);
      setRejectingReq(null);
      notifyPendingRequestsUpdated();
      await fetchRequests();
    } catch (err) {
      setRejectError(extractErrorMessage(err, 'Failed to reject asset request'));
    } finally {
      setIsRejecting(false);
    }
  };

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-bold text-slate-900">Asset Requests</h2>
            {pendingCount > 0 && (
              <span
                data-testid="asset-requests-pending-dot"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-700"
              >
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600" />
                </span>
                <span>{pendingCount} Pending</span>
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-0.5">
            {isEmployee
              ? 'Submit a category and reason. Approval does not assign hardware — Admin assigns from Assets, or you register via New Asset Register on My Assets.'
              : 'Review employee asks. If AVAILABLE stock exists for the category, approve and assign it here; otherwise mark No Asset Available and optionally remind the employee to register.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            aria-label="Filter by Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">All Statuses</option>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
          <button
            type="button"
            onClick={() => fetchRequests()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          {isEmployee && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New Asset Request
            </button>
          )}
        </div>
      </div>

      {toastError && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{toastError}</span>
        </div>
      )}
      {toastSuccess && (
        <div
          data-testid="toast-success"
          className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastSuccess}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {!isEmployee && (
                  <th className="py-3 px-4 whitespace-nowrap">Employee</th>
                )}
                <th className="py-3 px-4 whitespace-nowrap">Category</th>
                <th className="py-3 px-4 whitespace-nowrap">Reason</th>
                <th className="py-3 px-4 whitespace-nowrap">Status</th>
                <th className="py-3 px-4 whitespace-nowrap">Decision</th>
                {isManagerOrAdmin && (
                  <th className="py-3 px-4 whitespace-nowrap text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={isManagerOrAdmin ? 6 : 4}
                    className="py-12 text-center text-slate-600"
                  >
                    Loading asset requests...
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td
                    colSpan={isManagerOrAdmin ? 6 : 4}
                    className="py-12 text-center text-slate-600"
                  >
                    No asset requests found.
                  </td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr
                    key={req.id}
                    data-testid={`asset-request-${req.id}`}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    {!isEmployee && (
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                        <div className="font-medium text-slate-900">
                          {req.requester_name ?? `User #${req.requested_by}`}
                        </div>
                        <div className="text-xs text-slate-500">
                          {req.requester_email}
                        </div>
                      </td>
                    )}
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-700">
                      {req.is_other ? (
                        <div>
                          <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            Other
                          </span>
                          <div className="text-xs font-medium text-slate-900 mt-1">
                            {req.other_category_name}
                          </div>
                        </div>
                      ) : (
                        <span className="font-medium text-slate-900">
                          {req.category_name ?? req.name}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 align-middle text-slate-700 max-w-sm">
                      {req.reason || req.other_reason || '—'}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${getAssetRequestStatusBadgeClasses(
                          req.status,
                        )}`}
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 align-middle text-xs text-slate-600 max-w-xs">
                      {req.decision_comment ?? '—'}
                      {req.decider_name && (
                        <div className="text-slate-400 mt-0.5">
                          by {req.decider_name}
                        </div>
                      )}
                    </td>
                    {isManagerOrAdmin && (
                      <td className="py-3.5 px-4 align-middle text-right whitespace-nowrap">
                        {req.status === 'PENDING' ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openApproveModal(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => openRejectModal(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <EmployeeAssetRequestModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={async (created) => {
          setToastSuccess(`Asset request #${created.id} submitted for review`);
          notifyPendingRequestsUpdated();
          await fetchRequests();
        }}
      />

      {/* Approve Modal */}
      {approvingReq && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Approve Asset Request Modal"
          className="ams-modal fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        >
          <div className="ams-modal-panel bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Approve Asset Request #{approvingReq.id}
              </h3>
              <button
                type="button"
                onClick={() => setApprovingReq(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close approve modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleApprove} className="p-6 space-y-4">
              {approveError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
                >
                  {approveError}
                </div>
              )}
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-sm">
                <p className="font-semibold text-slate-900">{approvingReq.name}</p>
                <p className="text-xs text-slate-600 mt-1">
                  {approvingReq.requester_name}
                  {approvingReq.reason ? ` · ${approvingReq.reason}` : ''}
                </p>
                {approvingReq.is_other && (
                  <p className="text-xs text-amber-700 mt-2">
                    Other: {approvingReq.other_category_name} —{' '}
                    {approvingReq.other_reason}
                  </p>
                )}
              </div>
              {approvingReq.is_other && (
                <div>
                  <label
                    htmlFor="approve-category"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Category mapping
                  </label>
                  <select
                    id="approve-category"
                    aria-label="Approve Category"
                    value={approveCategoryId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setApproveCategoryId(next);
                      void loadAvailableStock(approvingReq, next);
                    }}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="">
                      Auto — use / create &quot;{approvingReq.other_category_name}&quot;
                    </option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={String(cat.id)}>
                        Map to {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-900">Inventory</p>
                {isLoadingStock ? (
                  <p className="text-xs text-slate-500">Checking available stock…</p>
                ) : hasAvailableStock ? (
                  <div>
                    <label
                      htmlFor="approve-asset"
                      className="block text-sm font-medium text-slate-900 mb-1"
                    >
                      Available asset
                    </label>
                    <select
                      id="approve-asset"
                      aria-label="Available asset"
                      required
                      value={selectedAssetId}
                      onChange={(e) => setSelectedAssetId(e.target.value)}
                      className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {availableAssets.map((asset) => (
                        <option key={asset.id} value={String(asset.id)}>
                          {asset.tag} — {asset.name}
                          {asset.serial_no ? ` (${asset.serial_no})` : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-600 mt-1.5">
                      Approving will assign this asset to{' '}
                      {approvingReq.requester_name ?? 'the employee'} immediately.
                    </p>
                  </div>
                ) : (
                  <>
                    <div
                      role="status"
                      aria-label="No Asset Available currently"
                      className="p-3.5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900 font-medium"
                    >
                      No Asset Available currently
                    </div>
                    <label
                      htmlFor="approve-employee-fill"
                      className="flex items-start gap-3 p-3.5 rounded-lg border border-slate-200 bg-white cursor-pointer"
                    >
                      <input
                        id="approve-employee-fill"
                        type="checkbox"
                        aria-label="Should be filled by an Employee"
                        checked={approveEmployeeWillRegister}
                        onChange={(e) =>
                          setApproveEmployeeWillRegister(e.target.checked)
                        }
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                      />
                      <span>
                        <span className="block text-sm font-medium text-slate-900">
                          Should be filled by an Employee
                        </span>
                        <span className="block text-xs text-slate-600 mt-0.5">
                          {approveEmployeeWillRegister
                            ? 'Employee gets a My Assets reminder until they use New Asset Register.'
                            : 'Off — you register it yourself from Assets when it arrives.'}
                        </span>
                      </span>
                    </label>
                  </>
                )}
              </div>
              <div>
                <label
                  htmlFor="approve-comment"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Comment{' '}
                  <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="approve-comment"
                  aria-label="Approve Comment"
                  rows={2}
                  value={approveComment}
                  onChange={(e) => setApproveComment(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setApprovingReq(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isApproving || isLoadingStock}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {isApproving
                    ? 'Approving...'
                    : hasAvailableStock
                      ? 'Approve & Assign'
                      : 'Confirm Approve'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectingReq && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reject Asset Request Modal"
          className="ams-modal fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        >
          <div className="ams-modal-panel bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Reject Asset Request #{rejectingReq.id}
              </h3>
              <button
                type="button"
                onClick={() => setRejectingReq(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close reject modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleReject} className="p-6 space-y-4">
              {rejectError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"
                >
                  {rejectError}
                </div>
              )}
              <div>
                <label
                  htmlFor="reject-comment"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Rejection Comment *
                </label>
                <textarea
                  id="reject-comment"
                  aria-label="Rejection Comment"
                  rows={3}
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                  placeholder="Explain why this request is rejected..."
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRejectingReq(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRejecting}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {isRejecting ? 'Rejecting...' : 'Confirm Reject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
