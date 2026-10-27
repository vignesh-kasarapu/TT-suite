import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeftRight, X, XCircle } from 'lucide-react';
import { listAssetsApi } from '../api/assets';
import { extractErrorMessage } from '../api/client';
import {
  approveReplacementRequestApi,
  holdReplacementRequestApi,
  rejectReplacementRequestApi,
} from '../api/replacements';
import type { Asset, ReplacementRequest } from '../types';

interface ApproveModalProps {
  request: ReplacementRequest;
  onClose: () => void;
  onSuccess: (updated: ReplacementRequest, message: string) => void;
}

export const ApproveReplacementModal: React.FC<ApproveModalProps> = ({
  request,
  onClose,
  onSuccess,
}) => {
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [approveComment, setApproveComment] = useState<string>('');
  const [approveError, setApproveError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [isHolding, setIsHolding] = useState<boolean>(false);
  const [isLoadingStock, setIsLoadingStock] = useState<boolean>(true);

  const categoryLabel =
    request.asset_category_name ??
    (request.asset_category_id != null
      ? `Category #${request.asset_category_id}`
      : 'this category');

  useEffect(() => {
    let active = true;
    (async () => {
      setIsLoadingStock(true);
      try {
        const res = await listAssetsApi({
          status: 'AVAILABLE',
          size: 100,
          ...(request.asset_category_id != null
            ? { category: request.asset_category_id }
            : {}),
        });
        if (!active) return;
        const candidates = res.items.filter(
          (a) =>
            a.id !== request.asset_id &&
            (request.asset_category_id == null ||
              a.category_id === request.asset_category_id),
        );
        setAvailableAssets(candidates);
        setSelectedAssetId(
          candidates.length > 0 ? String(candidates[0].id) : '',
        );
      } catch (err) {
        if (active) {
          setApproveError(
            extractErrorMessage(err, 'Failed to load available replacement assets'),
          );
        }
      } finally {
        if (active) {
          setIsLoadingStock(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [request.asset_id, request.asset_category_id]);

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApproveError(null);

    if (availableAssets.length === 0) {
      setApproveError(
        `No AVAILABLE ${categoryLabel} assets — use Keep On Hold so the employee can see it.`,
      );
      return;
    }

    if (!selectedAssetId) {
      setApproveError('Please select an AVAILABLE replacement asset');
      return;
    }

    setIsApproving(true);
    try {
      const updated = await approveReplacementRequestApi(request.id, {
        replacement_asset_id: Number(selectedAssetId),
        comment: approveComment.trim() || undefined,
      });
      onSuccess(
        updated,
        `Approved request #${updated.id}: old asset ${
          updated.asset_tag ?? `#${updated.asset_id}`
        } moved to ${
          updated.old_asset_action === 'REPAIR' ? 'IN_MAINTENANCE' : 'RETIRED'
        } and replacement ${
          updated.replacement_asset_tag ?? `#${updated.replacement_asset_id}`
        } assigned.`,
      );
    } catch (err) {
      setApproveError(
        extractErrorMessage(err, 'Failed to approve replacement request'),
      );
    } finally {
      setIsApproving(false);
    }
  };

  const noStock = !isLoadingStock && availableAssets.length === 0;

  const handleKeepOnHold = async () => {
    setApproveError(null);
    setIsHolding(true);
    try {
      const updated = await holdReplacementRequestApi(request.id, {
        comment: `Awaiting AVAILABLE ${categoryLabel} stock`,
      });
      onSuccess(
        updated,
        `Request #${updated.id} is ON HOLD — visible to ${
          updated.requester_name ?? 'the employee'
        } and managers until matching stock is available.`,
      );
    } catch (err) {
      setApproveError(
        extractErrorMessage(err, 'Failed to mark replacement request on hold'),
      );
    } finally {
      setIsHolding(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Approve Replacement Modal"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ArrowLeftRight className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">
              Approve Replacement Request #{request.id}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleApproveSubmit} className="p-6 space-y-4">
          {approveError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{approveError}</span>
            </div>
          )}

          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">Swap Summary:</p>
            <p>
              1. Return{' '}
              <strong className="font-mono text-blue-600">
                {request.asset_tag ?? `Asset #${request.asset_id}`}
              </strong>{' '}
              ({request.asset_name}
              {request.asset_category_name
                ? ` · ${request.asset_category_name}`
                : ''}
              ) with reason{' '}
              <code className="font-mono font-semibold">REPLACEMENT</code>.
            </p>
            <p>
              2. Transition old asset to{' '}
              <strong className="text-slate-900">
                {request.old_asset_action === 'REPAIR'
                  ? 'IN_MAINTENANCE (linked maintenance record created)'
                  : 'RETIRED'}
              </strong>
              .
            </p>
            <p>
              3. Assign a selected{' '}
              <strong className="text-emerald-700">AVAILABLE</strong>{' '}
              {categoryLabel} replacement to{' '}
              <strong className="text-slate-900">
                {request.requester_name ?? `User #${request.requested_by}`}
              </strong>
              {request.temporary
                ? ' (Temporary loaner — returned when maintenance is closed; original repaired asset becomes AVAILABLE for manual assign).'
                : '.'}
            </p>
          </div>

          {isLoadingStock ? (
            <p className="text-xs text-slate-500">
              Checking AVAILABLE {categoryLabel} stock…
            </p>
          ) : noStock ? (
            <div
              role="status"
              aria-label="No available assets in category — request on hold"
              className="p-3.5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900 space-y-1.5"
            >
              <p className="font-semibold">
                No AVAILABLE {categoryLabel} assets currently
              </p>
              <p className="text-xs text-amber-800">
                Mark <strong>ON HOLD</strong> so the employee and managers see this
                status on their pages. It is not approved or rejected — approve later
                when matching stock arrives.
              </p>
            </div>
          ) : (
            <div>
              <label
                htmlFor="replacement-asset-select"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
              >
                Select AVAILABLE {categoryLabel} Replacement *
              </label>
              <select
                id="replacement-asset-select"
                aria-label="Replacement Asset"
                value={selectedAssetId}
                onChange={(e) => setSelectedAssetId(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {availableAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.tag} — {asset.name} (SN: {asset.serial_no})
                  </option>
                ))}
              </select>
            </div>
          )}

          {!noStock && (
            <div>
              <label
                htmlFor="approve-comment-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
              >
                Approval Note (Optional)
              </label>
              <input
                id="approve-comment-input"
                aria-label="Approval Comment"
                type="text"
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                placeholder="Optional note for the employee..."
                className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            {noStock ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleKeepOnHold()}
                  disabled={isHolding}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold shadow-xs cursor-pointer"
                >
                  {isHolding ? 'Saving...' : 'Keep On Hold'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isApproving || isLoadingStock}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold shadow-xs cursor-pointer"
                >
                  {isApproving ? 'Approving...' : 'Confirm Swap'}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

interface RejectModalProps {
  request: ReplacementRequest;
  onClose: () => void;
  onSuccess: (updated: ReplacementRequest, message: string) => void;
}

export const RejectReplacementModal: React.FC<RejectModalProps> = ({
  request,
  onClose,
  onSuccess,
}) => {
  const [rejectComment, setRejectComment] = useState<string>('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [isRejecting, setIsRejecting] = useState<boolean>(false);

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRejectError(null);

    if (!rejectComment.trim()) {
      setRejectError('A rejection comment is required');
      return;
    }

    setIsRejecting(true);
    try {
      const updated = await rejectReplacementRequestApi(request.id, {
        comment: rejectComment.trim(),
      });
      onSuccess(
        updated,
        `Rejected replacement request #${updated.id} for ${
          updated.asset_tag ?? `Asset #${updated.asset_id}`
        }.`,
      );
    } catch (err) {
      setRejectError(
        extractErrorMessage(err, 'Failed to reject replacement request'),
      );
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reject Replacement Modal"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <XCircle className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">
              Reject Replacement Request #{request.id}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleRejectSubmit} className="p-6 space-y-4">
          {rejectError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{rejectError}</span>
            </div>
          )}

          <p className="text-xs text-slate-600">
            Rejecting request for{' '}
            <strong className="text-slate-900">
              {request.asset_tag ?? `Asset #${request.asset_id}`} ({request.asset_name})
            </strong>
            . The original asset will remain assigned to the employee.
          </p>

          <div>
            <label
              htmlFor="reject-comment-input"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
            >
              Rejection Comment *
            </label>
            <textarea
              id="reject-comment-input"
              aria-label="Rejection Comment"
              rows={3}
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="Provide a reason for rejecting this replacement request..."
              className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isRejecting}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold shadow-xs cursor-pointer"
            >
              {isRejecting ? 'Rejecting...' : 'Reject Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
