import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  Calendar,
  CheckCircle2,
  ClipboardEdit,
  Info,
  Laptop,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Tag,
  X,
} from 'lucide-react';
import {
  fillMyAssetDetailsApi,
  listMyAssetsApi,
} from '../api/assignments';
import { listAssetRequestsApi } from '../api/assetRequests';
import { extractErrorMessage } from '../api/client';
import {
  createReplacementRequestApi,
  listReplacementRequestsApi,
} from '../api/replacements';
import { EmployeeAssetRegisterModal } from '../components/EmployeeAssetRegisterModal';
import { EmployeeAssetRequestModal } from '../components/EmployeeAssetRequestModal';
import { notifyPendingRequestsUpdated } from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import type {
  AssetRequest,
  AssignedAsset,
  OldAssetAction,
  ReplacementRequest,
  ReplacementStatus,
} from '../types';
import { getAssetStatusBadgeClasses } from './AssetsPage';

export function getReplacementStatusBadgeClasses(status: ReplacementStatus): string {
  switch (status) {
    case 'PENDING':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'ON_HOLD':
      return 'bg-orange-50 text-orange-800 border-orange-200';
    case 'APPROVED':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'REJECTED':
    default:
      return 'bg-slate-100 text-slate-600 border-slate-300';
  }
}

export const MyAssetsPage: React.FC = () => {
  const { user } = useAuth();
  const [assets, setAssets] = useState<AssignedAsset[]>([]);
  const [requests, setRequests] = useState<ReplacementRequest[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toastSuccess, setToastSuccess] = useState<string | null>(null);

  // Request Replacement Modal state
  const [replacingAsset, setReplacingAsset] = useState<AssignedAsset | null>(null);
  const [reason, setReason] = useState<string>('');
  const [oldAssetAction, setOldAssetAction] = useState<OldAssetAction>('REPAIR');
  const [temporary, setTemporary] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Employee asset details (one-time fill) modal
  const [detailsAsset, setDetailsAsset] = useState<AssignedAsset | null>(null);
  const [detailsName, setDetailsName] = useState<string>('');
  const [detailsSerialNo, setDetailsSerialNo] = useState<string>('');
  const [detailsServiceTag, setDetailsServiceTag] = useState<string>('');
  const [detailsAssetTag, setDetailsAssetTag] = useState<string>('');
  const [detailsPurchaseDate, setDetailsPurchaseDate] = useState<string>('');
  const [detailsCost, setDetailsCost] = useState<string>('');
  const [detailsLocation, setDetailsLocation] = useState<string>('');
  const [detailsModalError, setDetailsModalError] = useState<string | null>(null);
  const [isSavingDetails, setIsSavingDetails] = useState<boolean>(false);

  // New asset register / request modals
  const [showNewAssetRegister, setShowNewAssetRegister] = useState<boolean>(false);
  const [showNewAssetRequest, setShowNewAssetRequest] = useState<boolean>(false);
  const [registerReminders, setRegisterReminders] = useState<AssetRequest[]>([]);

  const fetchMyAssetsAndRequests = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [assetsData, requestsData, assetRequestsData] = await Promise.all([
        listMyAssetsApi(),
        listReplacementRequestsApi().catch(() => [] as ReplacementRequest[]),
        listAssetRequestsApi('APPROVED').catch(() => [] as AssetRequest[]),
      ]);
      setAssets(assetsData);
      setRequests(requestsData);
      setRegisterReminders(
        assetRequestsData.filter((r) => r.requires_employee_register === true),
      );
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load your assigned assets'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMyAssetsAndRequests();
  }, [fetchMyAssetsAndRequests]);

  const openReplacementModal = (asset: AssignedAsset) => {
    setReplacingAsset(asset);
    setReason('');
    setOldAssetAction('REPAIR');
    setTemporary(false);
    setModalError(null);
  };

  const openDetailsModal = (asset: AssignedAsset) => {
    setDetailsAsset(asset);
    const awaiting = Boolean(asset.awaiting_employee_details);
    setDetailsName(awaiting ? '' : asset.name);
    setDetailsSerialNo(
      awaiting || asset.serial_no.startsWith('TMP-REQ-') ? '' : asset.serial_no,
    );
    setDetailsServiceTag(asset.service_tag ?? '');
    setDetailsAssetTag(asset.asset_tag ?? '');
    setDetailsPurchaseDate(awaiting ? new Date().toISOString().slice(0, 10) : asset.purchase_date);
    setDetailsCost(awaiting ? '' : String(asset.cost));
    setDetailsLocation(awaiting ? '' : asset.location);
    setDetailsModalError(null);
  };

  const awaitingFullDetails = Boolean(detailsAsset?.awaiting_employee_details);
  const canFillServiceTag = Boolean(
    detailsAsset && (awaitingFullDetails || !detailsAsset.service_tag),
  );
  const canFillAssetTag = Boolean(
    detailsAsset && (awaitingFullDetails || !detailsAsset.asset_tag),
  );
  const hasFillableDetails =
    awaitingFullDetails || canFillServiceTag || canFillAssetTag;

  const handleSaveAssetDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailsAsset) return;
    setDetailsModalError(null);

    if (awaitingFullDetails) {
      if (!detailsName.trim()) {
        setDetailsModalError('Asset name is required');
        return;
      }
      if (!detailsSerialNo.trim()) {
        setDetailsModalError('Serial number is required');
        return;
      }
      if (!detailsPurchaseDate) {
        setDetailsModalError('Purchase date is required');
        return;
      }
      if (
        detailsCost === '' ||
        Number.isNaN(Number(detailsCost)) ||
        Number(detailsCost) < 0
      ) {
        setDetailsModalError('Cost must be a number greater than or equal to 0');
        return;
      }
      if (!detailsLocation.trim()) {
        setDetailsModalError('Location is required');
        return;
      }
    } else {
      const hasTagUpdate =
        (canFillServiceTag && detailsServiceTag.trim()) ||
        (canFillAssetTag && detailsAssetTag.trim());
      if (!hasTagUpdate) {
        setDetailsModalError('Enter at least one blank field to save');
        return;
      }
    }

    setIsSavingDetails(true);
    try {
      const payload = awaitingFullDetails
        ? {
            name: detailsName.trim(),
            serial_no: detailsSerialNo.trim(),
            service_tag: detailsServiceTag.trim() || null,
            asset_tag: detailsAssetTag.trim() || null,
            purchase_date: detailsPurchaseDate,
            cost: Number(detailsCost),
            location: detailsLocation.trim(),
          }
        : {
            ...(canFillServiceTag && detailsServiceTag.trim()
              ? { service_tag: detailsServiceTag.trim() }
              : {}),
            ...(canFillAssetTag && detailsAssetTag.trim()
              ? { asset_tag: detailsAssetTag.trim() }
              : {}),
          };
      const updated = await fillMyAssetDetailsApi(detailsAsset.id, payload);
      setToastSuccess(
        `Saved details for ${updated.tag} (${updated.name}). These fields are now locked.`,
      );
      setDetailsAsset(null);
      await fetchMyAssetsAndRequests();
    } catch (err) {
      setDetailsModalError(
        extractErrorMessage(err, 'Failed to save asset details'),
      );
    } finally {
      setIsSavingDetails(false);
    }
  };

  const handleCreateReplacementRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replacingAsset) return;
    setModalError(null);

    if (!reason.trim()) {
      setModalError('Please enter a reason for the replacement request');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createReplacementRequestApi({
        asset_id: replacingAsset.id,
        reason: reason.trim(),
        old_asset_action: oldAssetAction,
        temporary: oldAssetAction === 'REPAIR' ? temporary : false,
      });
      setToastSuccess(
        `Replacement request #${created.id} submitted for ${replacingAsset.tag} (${replacingAsset.name}).`,
      );
      setReplacingAsset(null);
      await fetchMyAssetsAndRequests();
      notifyPendingRequestsUpdated();
    } catch (err) {
      setModalError(
        extractErrorMessage(err, 'Failed to submit replacement request'),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const pendingAssetIds = new Set(
    requests
      .filter((r) => r.status === 'PENDING' || r.status === 'ON_HOLD')
      .map((r) => r.asset_id),
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">My Assigned Assets</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Hardware and equipment currently assigned to{' '}
            <strong className="text-slate-900">{user?.name ?? user?.email}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchMyAssetsAndRequests}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-xs cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-blue-600" />
            <span>Refresh</span>
          </button>
          {user?.role === 'EMPLOYEE' && (
            <>
              <button
                type="button"
                onClick={() => setShowNewAssetRegister(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Asset Register</span>
              </button>
              <button
                type="button"
                onClick={() => setShowNewAssetRequest(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-semibold shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Asset Request</span>
              </button>
            </>
          )}
        </div>
      </div>

      {user?.role === 'EMPLOYEE' && registerReminders.length > 0 && (
        <div
          role="status"
          aria-label="Assets awaiting your registration"
          className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center gap-3"
        >
          <div className="flex items-start gap-2.5 flex-1 min-w-0">
            <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                {registerReminders.length === 1
                  ? 'You have an approved asset to register'
                  : `You have ${registerReminders.length} approved assets to register`}
              </p>
              <ul className="mt-1 text-xs text-amber-800 space-y-0.5">
                {registerReminders.map((req) => (
                  <li key={req.id} className="truncate">
                    #{req.id} · {req.category_name || req.name}
                    {req.reason ? ` — ${req.reason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowNewAssetRegister(true)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold shadow-xs cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            Register now
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2.5 text-sm text-red-700"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
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

      {/* Summary Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Laptop className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Assignments
            </p>
            <p className="text-lg font-bold text-slate-900">
              {assets.length} Held Asset{assets.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-cyan-50 text-cyan-700 border border-cyan-200">
          My Assets
        </span>
      </div>

      {/* Assets Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4 whitespace-nowrap">Asset ID</th>
                <th className="py-3 px-4 whitespace-nowrap">Asset Tag</th>
                <th className="py-3 px-4 whitespace-nowrap">Service Tag</th>
                <th className="py-3 px-4 whitespace-nowrap">Asset Name</th>
                <th className="py-3 px-4 whitespace-nowrap">Category</th>
                <th className="py-3 px-4 whitespace-nowrap">Serial Number</th>
                <th className="py-3 px-4 whitespace-nowrap">Location</th>
                <th className="py-3 px-4 whitespace-nowrap">Assigned Date</th>
                <th className="py-3 px-4 whitespace-nowrap">Status</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-600">
                    Loading your assigned assets...
                  </td>
                </tr>
              ) : assets.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-600">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="w-8 h-8 text-slate-400" />
                      <span>You do not have any assets currently assigned to you.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                assets.map((item) => {
                  const hasPendingRequest = pendingAssetIds.has(item.id);
                  return (
                    <tr
                      key={item.assignment_id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-blue-600">
                          <Tag className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                          {item.tag}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap font-mono text-xs text-slate-700">
                        {item.asset_tag || '—'}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap font-mono text-xs text-slate-700">
                        {item.service_tag || '—'}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap font-medium text-slate-900">
                        {item.name}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600">
                        {item.category_name ?? `Category #${item.category_id}`}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap font-mono text-xs text-slate-600">
                        {item.serial_no}
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          {item.location}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600 tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          {item.assigned_on}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${getAssetStatusBadgeClasses(
                            item.status,
                          )}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 align-middle text-right">
                        <div className="inline-flex items-center justify-end gap-1.5 flex-wrap whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openDetailsModal(item)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <ClipboardEdit className="w-3.5 h-3.5 text-blue-600" />
                            <span>
                              {item.awaiting_employee_details ||
                              !item.service_tag ||
                              !item.asset_tag
                                ? 'Fill Details'
                                : 'View Details'}
                            </span>
                          </button>
                          {hasPendingRequest ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              Pending Replacement
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openReplacementModal(item)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <ArrowLeftRight className="w-3.5 h-3.5" />
                              <span>Request Replacement</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* My Replacement Requests Section */}
      {requests.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                My Replacement Requests
              </h3>
              <p className="text-xs text-slate-600">
                Track approval status and temporary repair swaps
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-600">
              {requests.length} Request{requests.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4 whitespace-nowrap">Original Asset</th>
                  <th className="py-3 px-4 whitespace-nowrap">Action &amp; Type</th>
                  <th className="py-3 px-4 whitespace-nowrap">Reason</th>
                  <th className="py-3 px-4 whitespace-nowrap">Replacement Issued</th>
                  <th className="py-3 px-4 whitespace-nowrap">Status</th>
                  <th className="py-3 px-4 whitespace-nowrap">Manager Decision Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {requests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/80">
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-blue-600">
                        <Tag className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                        {req.asset_tag ?? `Asset #${req.asset_id}`}
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        {req.asset_name ?? '—'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-1.5">
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
                    <td className="py-3.5 px-4 align-middle text-slate-700 max-w-xs">
                      {req.reason}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      {req.replacement_asset_tag ? (
                        <div>
                          <span className="font-mono text-xs font-semibold text-emerald-700">
                            {req.replacement_asset_tag}
                          </span>
                          <div className="text-xs text-slate-600">
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
                    <td className="py-3.5 px-4 align-middle text-xs text-slate-600">
                      {req.decision_comment ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <EmployeeAssetRegisterModal
        open={showNewAssetRegister}
        onClose={() => setShowNewAssetRegister(false)}
        onRegistered={(created) => {
          setToastSuccess(
            `Registered ${created.tag} (${created.name}) — now listed under My Assets.`,
          );
          void fetchMyAssetsAndRequests();
        }}
      />

      <EmployeeAssetRequestModal
        open={showNewAssetRequest}
        onClose={() => setShowNewAssetRequest(false)}
        onCreated={(created) => {
          setToastSuccess(
            `Asset request #${created.id} submitted for review. Track it under Asset Requests.`,
          );
          notifyPendingRequestsUpdated();
        }}
      />

      {/* Employee Asset Details Modal (one-time fill) */}
      {detailsAsset && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Asset Details Modal"
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between sticky top-0">
              <div className="flex items-center gap-2.5">
                <ClipboardEdit className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">
                  {awaitingFullDetails
                    ? 'Complete Asset Details'
                    : hasFillableDetails
                      ? 'Fill Asset Details'
                      : 'Asset Details'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailsAsset(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close details modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAssetDetails} className="p-6 space-y-4" noValidate>
              {detailsModalError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{detailsModalError}</span>
                </div>
              )}

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Held Asset
                </p>
                <p className="text-sm font-bold text-slate-900 mt-0.5">
                  {detailsAsset.category_name ?? detailsAsset.name}
                </p>
                <p className="text-xs text-slate-600 font-mono mt-0.5">
                  Asset ID: {detailsAsset.tag}
                  {!awaitingFullDetails && (
                    <> &bull; SN: {detailsAsset.serial_no}</>
                  )}
                </p>
              </div>

              <div
                role="note"
                className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 flex items-start gap-2.5"
              >
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-800 leading-relaxed">
                  {awaitingFullDetails
                    ? 'Enter the full asset details once after your request was approved. After saving, you cannot edit them yourself — email Admin ('
                    : 'You can fill blank Service Tag and Asset Tag fields once. After saving, these details cannot be edited by you. To request a change, email Admin ('}
                  <a
                    href="mailto:admin@tektalis.com"
                    className="font-semibold underline underline-offset-2"
                  >
                    admin@tektalis.com
                  </a>
                  ) or Asset Manager (
                  <a
                    href="mailto:manager@tektalis.com"
                    className="font-semibold underline underline-offset-2"
                  >
                    manager@tektalis.com
                  </a>
                  ).
                </p>
              </div>

              {awaitingFullDetails && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="my-asset-name"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                    >
                      Asset Name
                    </label>
                    <input
                      id="my-asset-name"
                      aria-label="Asset Name"
                      type="text"
                      value={detailsName}
                      onChange={(e) => setDetailsName(e.target.value)}
                      placeholder="e.g. MacBook Pro 16 M4"
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="my-asset-serial"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                    >
                      Serial Number
                    </label>
                    <input
                      id="my-asset-serial"
                      aria-label="Serial Number"
                      type="text"
                      value={detailsSerialNo}
                      onChange={(e) => setDetailsSerialNo(e.target.value)}
                      placeholder="e.g. SN-MBP-1001"
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="my-asset-purchase-date"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                    >
                      Purchase Date
                    </label>
                    <input
                      id="my-asset-purchase-date"
                      aria-label="Purchase Date"
                      type="date"
                      value={detailsPurchaseDate}
                      onChange={(e) => setDetailsPurchaseDate(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="my-asset-cost"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                    >
                      Cost (₹)
                    </label>
                    <input
                      id="my-asset-cost"
                      aria-label="Cost"
                      type="number"
                      min="0"
                      step="0.01"
                      value={detailsCost}
                      onChange={(e) => setDetailsCost(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="my-asset-location"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                    >
                      Location
                    </label>
                    <input
                      id="my-asset-location"
                      aria-label="Location"
                      type="text"
                      value={detailsLocation}
                      onChange={(e) => setDetailsLocation(e.target.value)}
                      placeholder="e.g. HQ - Floor 3"
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="my-asset-service-tag"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                >
                  Service Tag{' '}
                  <span className="normal-case font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="my-asset-service-tag"
                  aria-label="Service Tag"
                  type="text"
                  value={detailsServiceTag}
                  onChange={(e) => setDetailsServiceTag(e.target.value)}
                  disabled={!canFillServiceTag}
                  placeholder={
                    canFillServiceTag
                      ? 'Enter service tag (optional)'
                      : 'Already set — locked'
                  }
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label
                  htmlFor="my-asset-asset-tag"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                >
                  Asset Tag{' '}
                  <span className="normal-case font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="my-asset-asset-tag"
                  aria-label="Asset Tag"
                  type="text"
                  value={detailsAssetTag}
                  onChange={(e) => setDetailsAssetTag(e.target.value)}
                  disabled={!canFillAssetTag}
                  placeholder={
                    canFillAssetTag
                      ? 'Enter asset tag (optional)'
                      : 'Already set — locked'
                  }
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDetailsAsset(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer"
                >
                  {hasFillableDetails ? 'Cancel' : 'Close'}
                </button>
                {hasFillableDetails && (
                  <button
                    type="submit"
                    disabled={isSavingDetails}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold shadow-xs cursor-pointer"
                  >
                    {isSavingDetails ? 'Saving...' : 'Save Details'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Request Replacement Modal */}
      {replacingAsset && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Request Replacement Modal"
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ArrowLeftRight className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Request Asset Replacement
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReplacingAsset(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateReplacementRequest} className="p-6 space-y-4">
              {modalError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              {/* Selected Asset Summary */}
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Current Held Asset
                  </p>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">
                    {replacingAsset.name}
                  </p>
                  <p className="text-xs text-slate-600 font-mono">
                    {replacingAsset.tag} &bull; SN: {replacingAsset.serial_no}
                  </p>
                </div>
                <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  {replacingAsset.status}
                </span>
              </div>

              {/* Old Asset Action */}
              <div>
                <label
                  htmlFor="old-asset-action-select"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                >
                  Old Asset Disposition
                </label>
                <select
                  id="old-asset-action-select"
                  aria-label="Old Asset Action"
                  value={oldAssetAction}
                  onChange={(e) => {
                    const nextAction = e.target.value as OldAssetAction;
                    setOldAssetAction(nextAction);
                    if (nextAction === 'RETIRE') {
                      setTemporary(false);
                    }
                  }}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="REPAIR">
                    REPAIR — Send current asset to Maintenance for repair
                  </option>
                  <option value="RETIRE">
                    RETIRE — Permanently retire current asset
                  </option>
                </select>
              </div>

              {/* Temporary Replacement Toggle */}
              <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    aria-label="Temporary Replacement"
                    checked={oldAssetAction === 'REPAIR' ? temporary : false}
                    disabled={oldAssetAction === 'RETIRE'}
                    onChange={(e) => setTemporary(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <div>
                    <span className="block text-sm font-semibold text-slate-900">
                      Temporary Loaner Replacement
                    </span>
                    <span className="block text-xs text-slate-600 mt-0.5">
                      {oldAssetAction === 'REPAIR'
                        ? 'When the repair maintenance record is closed, the loaner asset will automatically return to AVAILABLE and your repaired original asset will be reassigned to you.'
                        : 'Temporary replacement is only available when the old asset is sent for REPAIR.'}
                    </span>
                  </div>
                </label>
              </div>

              {/* Reason */}
              <div>
                <label
                  htmlFor="replacement-reason-input"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                >
                  Reason for Replacement *
                </label>
                <textarea
                  id="replacement-reason-input"
                  aria-label="Replacement Reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe the hardware issue or reason for requesting a replacement..."
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setReplacingAsset(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold shadow-xs cursor-pointer"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
