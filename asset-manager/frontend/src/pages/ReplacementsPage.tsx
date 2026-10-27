import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Tag,
  X,
  XCircle,
} from 'lucide-react';
import { extractErrorMessage } from '../api/client';
import { listReplacementRequestsApi } from '../api/replacements';
import {
  ApproveReplacementModal,
  RejectReplacementModal,
} from '../components/ReplacementDecisionModals';
import { notifyPendingRequestsUpdated } from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import type { ReplacementRequest, ReplacementStatus } from '../types';
import { getReplacementStatusBadgeClasses } from './MyAssetsPage';

export const ReplacementsPage: React.FC = () => {
  const { user } = useAuth();
  const isManagerOrAdmin =
    user?.role === 'ADMIN' || user?.role === 'ASSET_MANAGER';

  const [requests, setRequests] = useState<ReplacementRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toastError, setToastError] = useState<string | null>(null);
  const [toastSuccess, setToastSuccess] = useState<string | null>(null);

  const [approvingReq, setApprovingReq] = useState<ReplacementRequest | null>(null);
  const [rejectingReq, setRejectingReq] = useState<ReplacementRequest | null>(null);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    setToastError(null);
    try {
      const data = await listReplacementRequestsApi(
        statusFilter ? (statusFilter as ReplacementStatus) : undefined,
      );
      setRequests(data);
    } catch (err) {
      setToastError(
        extractErrorMessage(err, 'Failed to load replacement requests'),
      );
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const openApproveModal = (req: ReplacementRequest) => {
    setApprovingReq(req);
  };

  const openRejectModal = (req: ReplacementRequest) => {
    setRejectingReq(req);
  };

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;
  const onHoldCount = requests.filter((r) => r.status === 'ON_HOLD').length;
  const openCount = pendingCount + onHoldCount;
  const approvedCount = requests.filter((r) => r.status === 'APPROVED').length;
  const completedCount = requests.filter((r) => r.status === 'COMPLETED').length;
  const rejectedCount = requests.filter((r) => r.status === 'REJECTED').length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-bold text-slate-900">
              Replacement Requests Engine
            </h2>
            {openCount > 0 && (
              <span
                data-testid="replacements-pending-dot"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-700"
                title={`${pendingCount} pending, ${onHoldCount} on hold`}
              >
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600" />
                </span>
                <span>
                  {openCount} Open
                  {onHoldCount > 0 ? ` (${onHoldCount} on hold)` : ''}
                </span>
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-0.5">
            Review replacement requests, approve swaps, and track temporary loaners
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            aria-label="Filter by Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="">All Statuses</option>
            <option value="PENDING">PENDING</option>
            <option value="ON_HOLD">ON_HOLD</option>
            <option value="APPROVED">APPROVED</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="REJECTED">REJECTED</option>
          </select>

          <button
            type="button"
            onClick={fetchRequests}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-xs cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-blue-600" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {toastError && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between gap-2.5 text-sm text-red-700"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{toastError}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastError(null)}
            className="text-red-700 hover:text-red-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {toastSuccess && (
        <div
          role="status"
          className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2.5 text-sm text-emerald-700"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toastSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Pending Approval
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {pendingCount}
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            PENDING
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              On Hold
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {onHoldCount}
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-orange-50 text-orange-800 border border-orange-200">
            ON_HOLD
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Approved Swaps
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {approvedCount}
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            APPROVED
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Completed
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {completedCount}
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            COMPLETED
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Rejected
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {rejectedCount}
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-300">
            REJECTED
          </span>
        </div>
      </div>

      {/* Replacement Requests Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4 whitespace-nowrap">Request</th>
                <th className="py-3 px-4 whitespace-nowrap">Employee</th>
                <th className="py-3 px-4 whitespace-nowrap">Original Asset</th>
                <th className="py-3 px-4 whitespace-nowrap">Disposition &amp; Type</th>
                <th className="py-3 px-4 whitespace-nowrap">Reason &amp; Decision Note</th>
                <th className="py-3 px-4 whitespace-nowrap">Replacement Asset</th>
                <th className="py-3 px-4 whitespace-nowrap">Status</th>
                {isManagerOrAdmin && (
                  <th className="py-3 px-4 whitespace-nowrap text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={isManagerOrAdmin ? 8 : 7}
                    className="py-12 text-center text-slate-600"
                  >
                    Loading replacement requests...
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td
                    colSpan={isManagerOrAdmin ? 8 : 7}
                    className="py-12 text-center text-slate-600"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <Clock className="w-8 h-8 text-slate-400" />
                      <span>No replacement requests found.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr
                    key={req.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap font-mono text-xs font-semibold text-slate-700">
                      #{req.id}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <div className="font-medium text-slate-900">
                        {req.requester_name ?? `User #${req.requested_by}`}
                      </div>
                      {req.requester_email && (
                        <div className="text-xs text-slate-600">
                          {req.requester_email}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-blue-600">
                        <Tag className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                        {req.asset_tag ?? `Asset #${req.asset_id}`}
                      </span>
                      <div className="text-xs text-slate-700 font-medium mt-1">
                        {req.asset_name ?? '—'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          {req.old_asset_action}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${
                            req.temporary
                              ? 'bg-cyan-50 text-cyan-700 border-cyan-200'
                              : 'bg-slate-50 text-slate-600 border-slate-200'
                          }`}
                        >
                          {req.temporary ? 'Temporary Loaner' : 'Permanent'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 align-middle max-w-xs">
                      <p className="text-slate-900 text-sm">{req.reason}</p>
                      {req.decision_comment && (
                        <p className="text-xs text-slate-600 mt-1 italic">
                          Decision: &ldquo;{req.decision_comment}&rdquo;
                        </p>
                      )}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      {req.replacement_asset_tag ? (
                        <div>
                          <span className="font-mono text-xs font-semibold text-emerald-700">
                            {req.replacement_asset_tag}
                          </span>
                          <div className="text-xs text-slate-600 mt-1">
                            {req.replacement_asset_name}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${getReplacementStatusBadgeClasses(
                          req.status,
                        )}`}
                      >
                        {req.status}
                      </span>
                    </td>
                    {isManagerOrAdmin && (
                      <td className="py-3.5 px-4 align-middle text-right whitespace-nowrap">
                        {req.status === 'PENDING' || req.status === 'ON_HOLD' ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openApproveModal(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openRejectModal(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50/60 hover:bg-blue-100 text-blue-700 text-xs font-semibold cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5 text-blue-600" />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Decided</span>
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

      {approvingReq && (
        <ApproveReplacementModal
          request={approvingReq}
          onClose={() => setApprovingReq(null)}
          onSuccess={async (_updated, message) => {
            setApprovingReq(null);
            setToastSuccess(message);
            await fetchRequests();
            notifyPendingRequestsUpdated();
          }}
        />
      )}

      {rejectingReq && (
        <RejectReplacementModal
          request={rejectingReq}
          onClose={() => setRejectingReq(null)}
          onSuccess={async (_updated, message) => {
            setRejectingReq(null);
            setToastSuccess(message);
            await fetchRequests();
            notifyPendingRequestsUpdated();
          }}
        />
      )}
    </div>
  );
};
