import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Tag,
  X,
  XCircle,
} from 'lucide-react';
import { extractErrorMessage } from '../api/client';
import {
  closeMaintenanceApi,
  listMaintenanceRecordsApi,
} from '../api/maintenance';
import { listReplacementRequestsApi } from '../api/replacements';
import {
  ApproveReplacementModal,
  RejectReplacementModal,
} from '../components/ReplacementDecisionModals';
import { notifyPendingRequestsUpdated } from '../components/Layout';
import type { MaintenanceRecord, ReplacementRequest } from '../types';

function formatEmployeeName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed || '—';
}

type UnifiedRow =
  | {
      kind: 'pending_replacement';
      sortKey: string;
      request: ReplacementRequest;
    }
  | {
      kind: 'maintenance';
      sortKey: string;
      record: MaintenanceRecord;
    };

export const MaintenancePage: React.FC = () => {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [pendingRequests, setPendingRequests] = useState<ReplacementRequest[]>([]);
  const [openOnly, setOpenOnly] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toastError, setToastError] = useState<string | null>(null);
  const [toastSuccess, setToastSuccess] = useState<string | null>(null);

  const [closingRecord, setClosingRecord] = useState<MaintenanceRecord | null>(null);
  const [closedOn, setClosedOn] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [closeCost, setCloseCost] = useState<string>('');
  const [closeResolution, setCloseResolution] = useState<string>('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState<boolean>(false);

  const [approvingReq, setApprovingReq] = useState<ReplacementRequest | null>(null);
  const [rejectingReq, setRejectingReq] = useState<ReplacementRequest | null>(null);

  const fetchLog = useCallback(async () => {
    setIsLoading(true);
    try {
      const [maintData, openReplacements] = await Promise.all([
        listMaintenanceRecordsApi({
          open_only: openOnly ? true : undefined,
        }),
        listReplacementRequestsApi(),
      ]);
      setRecords(maintData);
      setPendingRequests(
        openReplacements.filter(
          (r) => r.status === 'PENDING' || r.status === 'ON_HOLD',
        ),
      );
    } catch (err) {
      setToastError(extractErrorMessage(err, 'Failed to load maintenance log'));
    } finally {
      setIsLoading(false);
    }
  }, [openOnly]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const unifiedRows: UnifiedRow[] = useMemo(() => {
    const linkedRequestIds = new Set(
      records
        .map((r) => r.replacement_request_id)
        .filter((id): id is number => id !== null && id !== undefined),
    );

    const pendingRows: UnifiedRow[] = openOnly
      ? []
      : pendingRequests
          .filter((req) => !linkedRequestIds.has(req.id))
          .map((request) => ({
            kind: 'pending_replacement' as const,
            sortKey: request.created_at,
            request,
          }));

    const maintRows: UnifiedRow[] = records.map((record) => ({
      kind: 'maintenance' as const,
      sortKey: record.opened_on,
      record,
    }));

    return [...pendingRows, ...maintRows].sort((a, b) =>
      a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0,
    );
  }, [records, pendingRequests, openOnly]);

  const openCloseModal = (record: MaintenanceRecord) => {
    setClosingRecord(record);
    setClosedOn(new Date().toISOString().slice(0, 10));
    setCloseCost(record.cost !== null && record.cost !== undefined ? String(record.cost) : '');
    setCloseResolution('');
    setCloseError(null);
  };

  const handleConfirmClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closingRecord) return;
    setCloseError(null);

    if (!closeResolution.trim()) {
      setCloseError('Resolution note is required');
      return;
    }

    const parsedCost = closeCost.trim() !== '' ? Number(closeCost) : undefined;
    if (parsedCost !== undefined && (Number.isNaN(parsedCost) || parsedCost < 0)) {
      setCloseError('Cost must be a non-negative number');
      return;
    }

    setIsClosing(true);
    try {
      const closed = await closeMaintenanceApi(closingRecord.id, {
        closed_on: closedOn || undefined,
        cost: parsedCost,
        resolution: closeResolution.trim(),
      });
      setClosingRecord(null);
      setToastError(null);
      const isTemp =
        closingRecord.temporary === true ||
        closingRecord.replacement_request_id != null;
      setToastSuccess(
        isTemp && closingRecord.temporary
          ? `Closed maintenance for ${closed.asset_tag ?? `Asset #${closed.asset_id}`}: temporary loaner returned; original is AVAILABLE for manual assignment`
          : `Closed maintenance for ${closed.asset_tag ?? `Asset #${closed.asset_id}`}`,
      );
      await fetchLog();
      notifyPendingRequestsUpdated();
    } catch (err) {
      const msg = extractErrorMessage(err, 'Failed to close maintenance record');
      setCloseError(msg);
      setToastError(msg);
    } finally {
      setIsClosing(false);
    }
  };

  const pendingCount = pendingRequests.length;
  const openCount = records.filter((r) => !r.closed_on).length;
  const closedCount = records.filter((r) => Boolean(r.closed_on)).length;

  const typeLabel = (row: UnifiedRow): string => {
    if (row.kind === 'pending_replacement') {
      const { old_asset_action, temporary } = row.request;
      if (old_asset_action === 'RETIRE') return 'Retire';
      return temporary ? 'Temporary Repair' : 'Permanent Repair';
    }
    const r = row.record;
    if (!r.replacement_request_id) return 'Standalone';
    if (r.old_asset_action === 'RETIRE') return 'Retire';
    if (r.temporary) return 'Temporary Repair';
    return 'Permanent Repair';
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-bold text-slate-900">Maintenance Log</h2>
            {(pendingCount > 0 || openCount > 0) && (
              <span
                data-testid="maintenance-open-dot"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-700"
                title={`${pendingCount} pending approval(s), ${openCount} open maintenance`}
              >
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600" />
                </span>
                <span>
                  {pendingCount} Pending · {openCount} Open
                </span>
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-0.5">
            Approve replacement requests and close completed repairs in one place
          </p>
        </div>
      </div>

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

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div>
            <span className="text-slate-500">Pending Approval: </span>
            <strong className="text-blue-700">{pendingCount}</strong>
          </div>
          <div>
            <span className="text-slate-500">In Maintenance: </span>
            <strong className="text-amber-700">{openCount}</strong>
          </div>
          <div>
            <span className="text-slate-500">Completed: </span>
            <strong className="text-emerald-700">{closedCount}</strong>
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
          />
          <span>Show Open Maintenance Only</span>
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4 whitespace-nowrap">Asset</th>
                <th className="py-3 px-4 whitespace-nowrap">Employee</th>
                <th className="py-3 px-4 whitespace-nowrap">Reason</th>
                <th className="py-3 px-4 whitespace-nowrap">Type</th>
                <th className="py-3 px-4 whitespace-nowrap">Opened</th>
                <th className="py-3 px-4 whitespace-nowrap">Closed</th>
                <th className="py-3 px-4 whitespace-nowrap">Resolution</th>
                <th className="py-3 px-4 whitespace-nowrap">Status</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-600">
                    Loading maintenance log...
                  </td>
                </tr>
              ) : unifiedRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-600">
                    No maintenance log entries found.
                  </td>
                </tr>
              ) : (
                unifiedRows.map((row) => {
                  if (row.kind === 'pending_replacement') {
                    const req = row.request;
                    return (
                      <tr
                        key={`pending-${req.id}`}
                        data-testid={`log-pending-${req.id}`}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-blue-600">
                            <Tag className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                            {req.asset_tag ?? `AST-${req.asset_id}`}
                          </span>
                          <div className="text-xs text-slate-600 mt-1">
                            {req.asset_name ?? `Asset #${req.asset_id}`}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 align-middle whitespace-nowrap font-medium text-slate-900">
                          {formatEmployeeName(req.requester_name)}
                        </td>
                        <td className="py-3.5 px-4 align-middle text-slate-700 max-w-xs">
                          {req.reason}
                        </td>
                        <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-700">
                          {typeLabel(row)}
                        </td>
                        <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600 tabular-nums">
                          {req.created_at.slice(0, 10)}
                        </td>
                        <td className="py-3.5 px-4 align-middle text-slate-400">—</td>
                        <td className="py-3.5 px-4 align-middle text-slate-400">—</td>
                        <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                          {req.status === 'ON_HOLD' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-orange-50 text-orange-800 border border-orange-200">
                              <Clock className="w-3 h-3" />
                              On Hold
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                              <Clock className="w-3 h-3" />
                              Pending Approval
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 align-middle text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setApprovingReq(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setRejectingReq(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50/60 hover:bg-blue-100 text-blue-700 text-xs font-semibold cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5 text-blue-600" />
                              <span>Reject</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const r = row.record;
                  const reasonText = r.reason ?? r.description;
                  return (
                    <tr
                      key={`maint-${r.id}`}
                      data-testid={`log-maint-${r.id}`}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-blue-600">
                          <Tag className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                          {r.asset_tag ?? `AST-${r.asset_id}`}
                        </span>
                        <div className="text-xs text-slate-600 mt-1">
                          {r.asset_name ?? `Asset #${r.asset_id}`}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap font-medium text-slate-900">
                        {formatEmployeeName(r.employee_name)}
                      </td>
                      <td className="py-3.5 px-4 align-middle text-slate-700 max-w-xs">
                        {reasonText}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-700">
                        {typeLabel(row)}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600 tabular-nums">
                        {r.opened_on}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600 tabular-nums">
                        {r.closed_on ?? '—'}
                      </td>
                      <td className="py-3.5 px-4 align-middle text-slate-700 max-w-xs">
                        {r.closed_on ? r.resolution ?? '—' : '—'}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                        {r.closed_on ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Completed
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            In Maintenance
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 align-middle text-right whitespace-nowrap">
                        {!r.closed_on && (
                          <button
                            type="button"
                            onClick={() => openCloseModal(r)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white transition-colors cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Close Maintenance</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {closingRecord && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-maint-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-lg max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 id="close-maint-modal-title" className="text-base font-bold text-slate-900">
                  Close Maintenance — {closingRecord.asset_tag}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setClosingRecord(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmClose} className="p-6 space-y-4" noValidate>
              {closeError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{closeError}</span>
                </div>
              )}

              <p className="text-sm text-slate-600">
                {closingRecord.replacement_request_id ? (
                  <>
                    Closing this repair (linked to{' '}
                    <strong className="text-slate-900">
                      Replacement Request #{closingRecord.replacement_request_id}
                    </strong>
                    ) will complete the repair for{' '}
                    <strong className="text-slate-900">{closingRecord.asset_tag}</strong>.
                    {closingRecord.temporary === true && (
                      <>
                        {' '}
                        Because this was a temporary loaner, the loaner returns to{' '}
                        <strong className="text-emerald-700">AVAILABLE</strong> and the
                        repaired original also becomes{' '}
                        <strong className="text-emerald-700">AVAILABLE</strong> for you
                        to assign manually.
                      </>
                    )}
                  </>
                ) : (
                  <>
                    Closing this maintenance record will transition{' '}
                    <strong className="text-slate-900">{closingRecord.asset_tag}</strong> back to{' '}
                    <strong className="text-emerald-700">AVAILABLE</strong>.
                  </>
                )}
              </p>

              <div>
                <label
                  htmlFor="close-maint-resolution"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Resolution *
                </label>
                <textarea
                  id="close-maint-resolution"
                  aria-label="Resolution"
                  rows={3}
                  value={closeResolution}
                  onChange={(e) => setCloseResolution(e.target.value)}
                  placeholder="Describe what was done to resolve the issue..."
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="close-maint-date"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Closed Date
                  </label>
                  <input
                    id="close-maint-date"
                    type="date"
                    value={closedOn}
                    onChange={(e) => setClosedOn(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label
                    htmlFor="close-maint-cost"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Final Cost (₹)
                  </label>
                  <input
                    id="close-maint-cost"
                    type="number"
                    step="0.01"
                    min="0"
                    value={closeCost}
                    onChange={(e) => setCloseCost(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setClosingRecord(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isClosing}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {isClosing ? 'Closing...' : 'Confirm Close'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {approvingReq && (
        <ApproveReplacementModal
          request={approvingReq}
          onClose={() => setApprovingReq(null)}
          onSuccess={async (_updated, message) => {
            setApprovingReq(null);
            setToastSuccess(message);
            await fetchLog();
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
            await fetchLog();
            notifyPendingRequestsUpdated();
          }}
        />
      )}
    </div>
  );
};
