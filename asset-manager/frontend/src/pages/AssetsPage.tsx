import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  CornerDownLeft,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  History,
  PackagePlus,
  Plus,
  Search,
  Tag,
  Upload,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react';
import {
  createAssetApi,
  listAssetsApi,
  retireAssetApi,
  updateAssetApi,
} from '../api/assets';
import {
  assignAssetApi,
  getAssetHistoryApi,
  returnAssetApi,
} from '../api/assignments';
import { listCategoriesApi } from '../api/categories';
import { extractErrorMessage } from '../api/client';
import {
  closeMaintenanceApi,
  openMaintenanceApi,
} from '../api/maintenance';
import {
  downloadAssetsCsvApi,
  downloadAssetsPdfApi,
  triggerFileDownload,
  type RegisterExportParams,
} from '../api/reports';
import { listUserDirectoryApi } from '../api/users';
import {
  BulkImportModal,
  DATA_IMPORTED_EVENT,
} from '../components/BulkImportModal';
import { useAuth } from '../context/AuthContext';
import type {
  Asset,
  AssetHistoryResponse,
  AssetStatus,
  Category,
  ReturnReason,
  User,
} from '../types';

export function getAssetStatusBadgeClasses(status: AssetStatus): string {
  switch (status) {
    case 'AVAILABLE':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'ASSIGNED':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'IN_MAINTENANCE':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'RETIRED':
    default:
      return 'bg-slate-100 text-slate-600 border-slate-300';
  }
}

const CATEGORY_CODE_MAP: Record<string, string> = {
  laptop: 'LPT',
  monitor: 'MON',
  phone: 'PHN',
  furniture: 'FRN',
  tablet: 'TBL',
  server: 'SRV',
  network: 'NET',
  accessory: 'ACC',
  printer: 'PRT',
  audio: 'AUD',
};

export function deriveCategoryCode(categoryName: string): string {
  const cleaned = categoryName.trim().toLowerCase();
  if (CATEGORY_CODE_MAP[cleaned]) {
    return CATEGORY_CODE_MAP[cleaned];
  }
  const alnum = categoryName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!alnum) return 'GEN';
  const consonants =
    alnum[0] +
    alnum
      .slice(1)
      .split('')
      .filter((c) => !'AEIOU'.includes(c))
      .join('');
  const code = (consonants.length >= 3 ? consonants : alnum).slice(0, 3);
  return code.padEnd(3, 'X');
}

export function deriveItemHexCode(assetName: string, categoryId: number): string {
  const tokens: string[] = assetName.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  let initials = 'AS';
  const firstToken = tokens[0];
  const secondToken = tokens[1];
  if (firstToken && secondToken) {
    initials = `${firstToken.charAt(0)}${secondToken.charAt(0)}`;
  } else if (firstToken) {
    initials = firstToken.slice(0, 2).padEnd(2, 'X');
  }
  const joined = tokens.join('');
  const catNibble = (categoryId & 0x0f).toString(16).toUpperCase();
  let sum = 0;
  for (let i = 0; i < joined.length; i += 1) {
    sum += joined.charCodeAt(i);
  }
  const modelNibble = (sum & 0x0f).toString(16).toUpperCase();
  return `${initials}${catNibble}${modelNibble}`;
}

export function decodeAssetTag(tag: string, categoryName?: string): string {
  const parts = tag.split('-');
  if (parts.length === 4 && parts[0].toUpperCase() === 'TEK') {
    const [, catCode, itemCode, hexSeq] = parts;
    const seqDec = Number.parseInt(hexSeq, 16);
    const seqLabel = Number.isNaN(seqDec) ? hexSeq : `0x${hexSeq} (#${seqDec})`;
    return `Org: TEK | Category: ${catCode}${categoryName ? ` (${categoryName})` : ''} | Item Hex Code: ${itemCode} | Hex Sequence: ${seqLabel}`;
  }
  return `Asset ID: ${tag}`;
}

export const AssetsPage: React.FC = () => {
  const { user } = useAuth();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pages, setPages] = useState<number>(1);

  const [search, setSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<AssetStatus | ''>('');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toastError, setToastError] = useState<string | null>(null);
  const [toastSuccess, setToastSuccess] = useState<string | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState<boolean>(false);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);

  // Create Asset Modal state
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [isImportOpen, setIsImportOpen] = useState<boolean>(false);
  const [createName, setCreateName] = useState<string>('');
  const [createSerialNo, setCreateSerialNo] = useState<string>('');
  const [createServiceTag, setCreateServiceTag] = useState<string>('');
  const [createAssetTag, setCreateAssetTag] = useState<string>('');
  const [createCategoryId, setCreateCategoryId] = useState<string>('');
  const [createPurchaseDate, setCreatePurchaseDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [createCost, setCreateCost] = useState<string>('');
  const [createLocation, setCreateLocation] = useState<string>('');
  const [createModalError, setCreateModalError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // Edit Asset Modal state
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [editName, setEditName] = useState<string>('');
  const [editSerialNo, setEditSerialNo] = useState<string>('');
  const [editServiceTag, setEditServiceTag] = useState<string>('');
  const [editAssetTag, setEditAssetTag] = useState<string>('');
  const [editCategoryId, setEditCategoryId] = useState<string>('');
  const [editPurchaseDate, setEditPurchaseDate] = useState<string>('');
  const [editCost, setEditCost] = useState<string>('');
  const [editLocation, setEditLocation] = useState<string>('');
  const [editModalError, setEditModalError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  // Retire Asset Confirmation Modal state
  const [retiringAsset, setRetiringAsset] = useState<Asset | null>(null);
  const [retireModalError, setRetireModalError] = useState<string | null>(null);
  const [isRetiring, setIsRetiring] = useState<boolean>(false);

  // Assign Asset Modal state (FR-7)
  const [assigningAsset, setAssigningAsset] = useState<Asset | null>(null);
  const [directoryUsers, setDirectoryUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [assignedOnDate, setAssignedOnDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [assignModalError, setAssignModalError] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState<boolean>(false);

  // Return Asset Modal state (FR-8)
  const [returningAsset, setReturningAsset] = useState<Asset | null>(null);
  const [returnReason, setReturnReason] = useState<ReturnReason>('OTHER');
  const [returnedOnDate, setReturnedOnDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [returnMaintDescription, setReturnMaintDescription] = useState<string>('');
  const [returnModalError, setReturnModalError] = useState<string | null>(null);
  const [isReturning, setIsReturning] = useState<boolean>(false);

  // Open Maintenance Modal for AVAILABLE assets (FR-10, FR-11)
  const [maintainingAsset, setMaintainingAsset] = useState<Asset | null>(null);
  const [maintDescription, setMaintDescription] = useState<string>('');
  const [maintOpenedOn, setMaintOpenedOn] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [maintCost, setMaintCost] = useState<string>('');
  const [maintModalError, setMaintModalError] = useState<string | null>(null);
  const [isOpeningMaint, setIsOpeningMaint] = useState<boolean>(false);

  // Asset Detail & History Drawer state (FR-9)
  const [historyAssetId, setHistoryAssetId] = useState<number | null>(null);
  const [historyData, setHistoryData] = useState<AssetHistoryResponse | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await listCategoriesApi();
      setCategories(data);
    } catch (err) {
      setToastError(extractErrorMessage(err, 'Failed to load categories'));
    }
  }, []);

  const fetchAssets = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listAssetsApi({
        page,
        size: 20,
        sort: 'id,asc',
        search,
        category: categoryFilter,
        status: statusFilter,
      });
      setAssets(data.items);
      setTotal(data.total);
      setPages(data.pages);
    } catch (err) {
      setToastError(extractErrorMessage(err, 'Failed to load asset register'));
    } finally {
      setIsLoading(false);
    }
  }, [page, search, categoryFilter, statusFilter]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    const handleImported = () => {
      fetchAssets();
      fetchCategories();
    };
    window.addEventListener(DATA_IMPORTED_EVENT, handleImported);
    return () => {
      window.removeEventListener(DATA_IMPORTED_EVENT, handleImported);
    };
  }, [fetchAssets, fetchCategories]);

  const resolveCategoryName = (asset: Asset): string => {
    if (asset.category_name) return asset.category_name;
    const found = categories.find((c) => c.id === asset.category_id);
    return found ? found.name : `Category #${asset.category_id}`;
  };

  // Create Asset handlers
  const openCreateModal = () => {
    setCreateName('');
    setCreateSerialNo('');
    setCreateServiceTag('');
    setCreateAssetTag('');
    setCreateCategoryId(categories.length > 0 ? String(categories[0].id) : '1');
    setCreatePurchaseDate(new Date().toISOString().slice(0, 10));
    setCreateCost('');
    setCreateLocation('');
    setCreateModalError(null);
    setIsCreateOpen(true);
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateModalError(null);

    if (!createName.trim()) {
      setCreateModalError('Asset name is required');
      return;
    }
    if (!createSerialNo.trim()) {
      setCreateModalError('Serial number is required');
      return;
    }
    if (!createCategoryId) {
      setCreateModalError('Category is required');
      return;
    }
    if (!createPurchaseDate) {
      setCreateModalError('Purchase date is required');
      return;
    }
    const parsedCost = Number(createCost);
    if (createCost.trim() === '' || Number.isNaN(parsedCost) || parsedCost < 0) {
      setCreateModalError('Valid non-negative cost is required');
      return;
    }
    if (!createLocation.trim()) {
      setCreateModalError('Location is required');
      return;
    }

    setIsCreating(true);
    try {
      const created = await createAssetApi({
        name: createName.trim(),
        serial_no: createSerialNo.trim(),
        service_tag: createServiceTag.trim() || null,
        asset_tag: createAssetTag.trim() || null,
        category_id: Number(createCategoryId),
        purchase_date: createPurchaseDate,
        cost: parsedCost,
        location: createLocation.trim(),
      });
      setIsCreateOpen(false);
      setToastError(null);
      setToastSuccess(`Created asset ${created.tag} (${created.name})`);
      await Promise.all([fetchAssets(), fetchCategories()]);
    } catch (err) {
      const message = extractErrorMessage(err, 'Failed to create asset');
      setCreateModalError(message);
      setToastError(message);
    } finally {
      setIsCreating(false);
    }
  };

  // Edit Asset handlers
  const openEditModal = (asset: Asset) => {
    setEditingAsset(asset);
    setEditName(asset.name);
    setEditSerialNo(asset.serial_no);
    setEditServiceTag(asset.service_tag ?? '');
    setEditAssetTag(asset.asset_tag ?? '');
    setEditCategoryId(String(asset.category_id));
    setEditPurchaseDate(asset.purchase_date);
    setEditCost(String(asset.cost));
    setEditLocation(asset.location);
    setEditModalError(null);
  };

  const handleEditAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAsset) return;
    setEditModalError(null);

    if (!editName.trim()) {
      setEditModalError('Asset name is required');
      return;
    }
    if (!editSerialNo.trim()) {
      setEditModalError('Serial number is required');
      return;
    }
    const parsedCost = Number(editCost);
    if (editCost.trim() === '' || Number.isNaN(parsedCost) || parsedCost < 0) {
      setEditModalError('Valid non-negative cost is required');
      return;
    }
    if (!editLocation.trim()) {
      setEditModalError('Location is required');
      return;
    }

    setIsUpdating(true);
    try {
      const updated = await updateAssetApi(editingAsset.id, {
        name: editName.trim(),
        serial_no: editSerialNo.trim(),
        service_tag: editServiceTag.trim() || null,
        asset_tag: editAssetTag.trim() || null,
        category_id: Number(editCategoryId),
        purchase_date: editPurchaseDate,
        cost: parsedCost,
        location: editLocation.trim(),
      });
      setEditingAsset(null);
      setToastError(null);
      setToastSuccess(`Updated asset ${updated.tag} (${updated.name})`);
      await Promise.all([fetchAssets(), fetchCategories()]);
    } catch (err) {
      const message = extractErrorMessage(err, 'Failed to update asset');
      setEditModalError(message);
      setToastError(message);
    } finally {
      setIsUpdating(false);
    }
  };

  // Retire Asset handlers
  const openRetireModal = (asset: Asset) => {
    setRetiringAsset(asset);
    setRetireModalError(null);
  };

  const handleConfirmRetire = async () => {
    if (!retiringAsset) return;
    setRetireModalError(null);
    setIsRetiring(true);
    try {
      const retired = await retireAssetApi(retiringAsset.id);
      setRetiringAsset(null);
      setToastError(null);
      setToastSuccess(`Asset ${retired.tag} (${retired.name}) has been retired.`);
      await Promise.all([fetchAssets(), fetchCategories()]);
    } catch (err) {
      const message = extractErrorMessage(err, 'Failed to retire asset');
      setRetireModalError(message);
      setToastError(message);
    } finally {
      setIsRetiring(false);
    }
  };

  // Assign Asset handlers (FR-7)
  const openAssignModal = async (asset: Asset) => {
    setAssigningAsset(asset);
    setAssignModalError(null);
    setAssignedOnDate(new Date().toISOString().slice(0, 10));
    try {
      const usersList = await listUserDirectoryApi(true);
      setDirectoryUsers(usersList);
      setSelectedUserId(usersList.length > 0 ? String(usersList[0].id) : '');
    } catch (err) {
      setAssignModalError(extractErrorMessage(err, 'Failed to load active employees'));
    }
  };

  const handleAssignAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningAsset) return;
    setAssignModalError(null);

    if (!selectedUserId) {
      setAssignModalError('Please select an active employee');
      return;
    }

    setIsAssigning(true);
    try {
      const result = await assignAssetApi(assigningAsset.id, {
        user_id: Number(selectedUserId),
        assigned_on: assignedOnDate || undefined,
      });
      setAssigningAsset(null);
      setToastError(null);
      setToastSuccess(
        `Assigned ${assigningAsset.tag} to ${result.user_name ?? result.user_email ?? `User #${result.user_id}`}`,
      );
      await Promise.all([fetchAssets(), fetchCategories()]);
    } catch (err) {
      const message = extractErrorMessage(err, 'Failed to assign asset');
      setAssignModalError(message);
      setToastError(message);
    } finally {
      setIsAssigning(false);
    }
  };

  // Return Asset handlers (FR-8)
  const openReturnModal = (asset: Asset) => {
    setReturningAsset(asset);
    setReturnReason('OTHER');
    setReturnedOnDate(new Date().toISOString().slice(0, 10));
    setReturnMaintDescription('');
    setReturnModalError(null);
  };

  const handleReturnAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returningAsset) return;
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
          ? `Returned asset ${returningAsset.tag} to maintenance`
          : `Returned asset ${returningAsset.tag} (now AVAILABLE)`,
      );
      await Promise.all([fetchAssets(), fetchCategories()]);
    } catch (err) {
      const message = extractErrorMessage(err, 'Failed to return asset');
      setReturnModalError(message);
      setToastError(message);
    } finally {
      setIsReturning(false);
    }
  };

  // Asset Detail & History Drawer handlers (FR-9)
  const openHistoryDrawer = async (asset: Asset) => {
    setHistoryAssetId(asset.id);
    setHistoryData(null);
    setHistoryError(null);
    setIsHistoryLoading(true);
    try {
      const data = await getAssetHistoryApi(asset.id);
      setHistoryData(data);
    } catch (err) {
      setHistoryError(extractErrorMessage(err, 'Failed to load asset history'));
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const buildExportParams = (): RegisterExportParams => ({
    status: statusFilter,
    category_id: categoryFilter ? Number(categoryFilter) : '',
    search,
  });

  const handleExportCsv = async () => {
    setIsExportMenuOpen(false);
    setIsExportingCsv(true);
    setToastError(null);
    try {
      const blob = await downloadAssetsCsvApi(buildExportParams());
      triggerFileDownload(blob, 'assets_report.csv');
      setToastSuccess('Asset register CSV downloaded (assets_report.csv).');
    } catch (err) {
      setToastError(extractErrorMessage(err, 'Failed to export asset register CSV'));
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handleExportPdf = async () => {
    setIsExportMenuOpen(false);
    setIsExportingPdf(true);
    setToastError(null);
    try {
      const blob = await downloadAssetsPdfApi(buildExportParams());
      triggerFileDownload(blob, 'assets_report.pdf');
      setToastSuccess('Asset register PDF downloaded (assets_report.pdf).');
    } catch (err) {
      setToastError(extractErrorMessage(err, 'Failed to export asset register PDF'));
    } finally {
      setIsExportingPdf(false);
    }
  };

  const openMaintenanceModal = (asset: Asset) => {
    setMaintainingAsset(asset);
    setMaintDescription('');
    setMaintOpenedOn(new Date().toISOString().slice(0, 10));
    setMaintCost('');
    setMaintModalError(null);
  };

  const handleOpenMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!maintainingAsset) return;
    setMaintModalError(null);

    if (!maintDescription.trim()) {
      setMaintModalError('Please enter a maintenance description');
      return;
    }

    const parsedCost = maintCost.trim() !== '' ? Number(maintCost) : undefined;
    if (parsedCost !== undefined && (Number.isNaN(parsedCost) || parsedCost < 0)) {
      setMaintModalError('Cost must be a non-negative number');
      return;
    }

    setIsOpeningMaint(true);
    try {
      await openMaintenanceApi(maintainingAsset.id, {
        description: maintDescription.trim(),
        opened_on: maintOpenedOn || undefined,
        cost: parsedCost,
      });
      setToastSuccess(
        `Opened maintenance for ${maintainingAsset.tag} — status is now IN_MAINTENANCE`,
      );
      setMaintainingAsset(null);
      await fetchAssets();
    } catch (err) {
      setMaintModalError(
        extractErrorMessage(err, 'Failed to open maintenance record'),
      );
    } finally {
      setIsOpeningMaint(false);
    }
  };

  const handleCloseMaintenanceFromDrawer = async (recordId: number) => {
    if (!historyAssetId) return;
    try {
      await closeMaintenanceApi(recordId, {
        closed_on: new Date().toISOString().slice(0, 10),
        resolution: 'Closed from asset history',
      });
      setToastSuccess('Maintenance record closed and asset returned to AVAILABLE');
      const [updatedHistory] = await Promise.all([
        getAssetHistoryApi(historyAssetId),
        fetchAssets(),
        fetchCategories(),
      ]);
      setHistoryData(updatedHistory);
    } catch (err) {
      setHistoryError(extractErrorMessage(err, 'Failed to close maintenance record'));
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Asset Register</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Manage hardware inventory, assignments, and maintenance
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              data-testid="export-assets-btn"
              aria-expanded={isExportMenuOpen}
              aria-haspopup="menu"
              onClick={() => setIsExportMenuOpen((open) => !open)}
              disabled={isExportingCsv || isExportingPdf}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-sm font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4 text-blue-600" />
              <span>
                {isExportingCsv || isExportingPdf ? 'Exporting...' : 'Export'}
              </span>
            </button>
            {isExportMenuOpen && (
              <div
                role="menu"
                aria-label="Export asset register"
                className="absolute right-0 mt-1.5 z-20 w-52 rounded-lg border border-slate-200 bg-white shadow-lg py-1"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="export-assets-csv-btn"
                  onClick={() => void handleExportCsv()}
                  className="w-full px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="export-assets-pdf-btn"
                  onClick={() => void handleExportPdf()}
                  className="w-full px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-rose-600" />
                  <span>Export PDF</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            data-testid="open-import-assets-btn"
            onClick={() => setIsImportOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4 text-blue-600" />
            <span>Import Assets</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Asset</span>
          </button>
        </div>
      </div>

      {/* Compact inventory counts (category detail lives on Categories tab) */}
      <div
        aria-label="Inventory summary counts"
        className="grid grid-cols-2 gap-3 max-w-md"
      >
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Assets
          </p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {isLoading ? '...' : total}
          </p>
        </div>
        <Link
          to="/categories"
          className="bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-4 shadow-xs transition-colors"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Categories
          </p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {categories.length}
          </p>
          <p className="text-xs text-blue-600 font-medium mt-1">Manage &rarr;</p>
        </Link>
      </div>

      {/* Toast Feedback Banners */}
      {toastError && (
        <div
          role="alert"
          data-testid="toast-error"
          className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between gap-3 text-sm text-red-700 shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{toastError}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastError(null)}
            className="text-red-500 hover:text-red-700 cursor-pointer"
            aria-label="Dismiss error toast"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {toastSuccess && (
        <div
          role="status"
          data-testid="toast-success"
          className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-sm text-emerald-700 shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toastSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastSuccess(null)}
            className="text-emerald-600 hover:text-emerald-800 cursor-pointer"
            aria-label="Dismiss success toast"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search & Filters Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search assets"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name, Asset ID, tags, serial, or employee..."
            className="w-full pl-10 pr-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <select
          aria-label="Filter by category"
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={String(cat.id)}>
              {cat.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as AssetStatus | '');
            setPage(1);
          }}
          className="px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="">All Statuses</option>
          <option value="AVAILABLE">AVAILABLE</option>
          <option value="ASSIGNED">ASSIGNED</option>
          <option value="IN_MAINTENANCE">IN_MAINTENANCE</option>
          <option value="RETIRED">RETIRED</option>
        </select>
      </div>

      {/* Asset Table Card */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4 whitespace-nowrap">Asset ID</th>
                <th className="py-3 px-4 whitespace-nowrap">Asset Tag</th>
                <th className="py-3 px-4 whitespace-nowrap">Service Tag</th>
                <th className="py-3 px-4 whitespace-nowrap">Asset Name</th>
                <th className="py-3 px-4 whitespace-nowrap">Category</th>
                <th className="py-3 px-4 whitespace-nowrap">Serial No.</th>
                <th className="py-3 px-4 whitespace-nowrap">Assigned To</th>
                <th className="py-3 px-4 whitespace-nowrap">Location</th>
                <th className="py-3 px-4 whitespace-nowrap">Purchase Date</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">Cost</th>
                <th className="py-3 px-4 whitespace-nowrap">Status</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-600">
                    Loading assets...
                  </td>
                </tr>
              ) : assets.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-600">
                    No assets found matching the current filters.
                  </td>
                </tr>
              ) : (
                assets.map((asset) => (
                  <tr key={asset.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <span
                        title={decodeAssetTag(asset.tag, resolveCategoryName(asset))}
                        className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-blue-600"
                      >
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
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600">
                      {resolveCategoryName(asset)}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap font-mono text-xs text-slate-600">
                      {asset.serial_no || '—'}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600">
                      {asset.assigned_to_name || '—'}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600">
                      {asset.location}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap text-slate-600 tabular-nums">
                      {asset.purchase_date}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap text-right font-medium text-slate-900 tabular-nums">
                      ₹{Number(asset.cost).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${getAssetStatusBadgeClasses(
                          asset.status,
                        )}`}
                      >
                        {asset.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 align-middle text-right">
                      <div className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                        {asset.status === 'AVAILABLE' && (
                          <>
                            <button
                              type="button"
                              onClick={() => openAssignModal(asset)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white shadow-2xs transition-colors cursor-pointer"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              <span>Assign</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openMaintenanceModal(asset)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-800 transition-colors cursor-pointer"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                              <span>Maintenance</span>
                            </button>
                          </>
                        )}

                        {asset.status === 'ASSIGNED' && (
                          <button
                            type="button"
                            onClick={() => openReturnModal(asset)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-xs font-semibold text-blue-700 transition-colors cursor-pointer"
                          >
                            <CornerDownLeft className="w-3.5 h-3.5" />
                            <span>Return</span>
                          </button>
                        )}

                        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50/70 p-0.5 gap-0.5">
                          <button
                            type="button"
                            aria-label="History"
                            title="Asset Detail & History"
                            onClick={() => openHistoryDrawer(asset)}
                            className="p-1.5 rounded-md text-slate-600 hover:text-cyan-600 hover:bg-white hover:shadow-2xs transition-all cursor-pointer"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            aria-label="Edit"
                            title="Edit Asset"
                            onClick={() => openEditModal(asset)}
                            className="p-1.5 rounded-md text-slate-600 hover:text-blue-600 hover:bg-white hover:shadow-2xs transition-all cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          {asset.status !== 'RETIRED' && (
                            <button
                              type="button"
                              aria-label="Retire"
                              title="Retire Asset"
                              onClick={() => openRetireModal(asset)}
                              className="p-1.5 rounded-md text-slate-600 hover:text-amber-700 hover:bg-amber-50 hover:shadow-2xs transition-all cursor-pointer"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span>
            Showing <strong className="text-slate-900">{assets.length}</strong> of{' '}
            <strong className="text-slate-900">{total}</strong> asset(s)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-50 cursor-pointer"
            >
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-50 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Create Asset Modal */}
      {isCreateOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-asset-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-lg max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <PackagePlus className="w-5 h-5 text-blue-600" />
                <h3 id="create-asset-modal-title" className="text-base font-bold text-slate-900">
                  Create New Asset
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close create asset modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAsset} className="p-6 space-y-4" noValidate>
              {createModalError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{createModalError}</span>
                </div>
              )}

              {/* Live Alphanumeric + Hexadecimal Tag Preview */}
              {(() => {
                const selectedCat = categories.find(
                  (c) => String(c.id) === String(createCategoryId),
                );
                const catName = selectedCat?.name ?? 'Laptop';
                const catIdNum = selectedCat?.id ?? (Number(createCategoryId) || 1);
                const catCode = deriveCategoryCode(catName);
                const itemHexCode = deriveItemHexCode(
                  createName.trim() || 'Asset',
                  catIdNum,
                );
                const previewTag = `TEK-${catCode}-${itemHexCode}-XXXX`;

                return (
                  <div
                    data-testid="create-asset-tag-preview"
                    className="p-3 rounded-lg bg-blue-50/70 border border-blue-200 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
                        Auto-Generated Asset ID Preview
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        <strong className="text-slate-800">TEK</strong> (Org) &bull;{' '}
                        <strong className="text-slate-800">{catCode}</strong> ({catName}) &bull;{' '}
                        <strong className="text-slate-800">{itemHexCode}</strong> (Item + Hex ID) &bull;{' '}
                        <strong className="text-slate-800">XXXX</strong> (4-Digit Hex Seq)
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-md bg-white border border-blue-200 font-mono text-xs font-bold text-blue-700 shrink-0 shadow-2xs">
                      {previewTag}
                    </span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="create-asset-name"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Asset Name
                  </label>
                  <input
                    id="create-asset-name"
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="e.g. MacBook Pro 16 M4"
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="create-asset-category"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Category
                  </label>
                  <select
                    id="create-asset-category"
                    value={createCategoryId}
                    onChange={(e) => setCreateCategoryId(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {categories.map((cat) => (
                      <option key={cat.id} value={String(cat.id)}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="create-asset-serial"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Serial Number
                  </label>
                  <input
                    id="create-asset-serial"
                    type="text"
                    value={createSerialNo}
                    onChange={(e) => setCreateSerialNo(e.target.value)}
                    placeholder="e.g. SN-MBP-1001"
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="create-service-tag"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Service Tag{' '}
                    <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="create-service-tag"
                    type="text"
                    value={createServiceTag}
                    onChange={(e) => setCreateServiceTag(e.target.value)}
                    placeholder="e.g. SVC-7XK9M2"
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="create-asset-tag"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Asset Tag{' '}
                    <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="create-asset-tag"
                    type="text"
                    value={createAssetTag}
                    onChange={(e) => setCreateAssetTag(e.target.value)}
                    placeholder="e.g. TEK-MBP-14"
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="create-asset-date"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Purchase Date
                  </label>
                  <input
                    id="create-asset-date"
                    type="date"
                    value={createPurchaseDate}
                    onChange={(e) => setCreatePurchaseDate(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="create-asset-cost"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Cost (₹)
                  </label>
                  <input
                    id="create-asset-cost"
                    type="number"
                    step="0.01"
                    min="0"
                    value={createCost}
                    onChange={(e) => setCreateCost(e.target.value)}
                    placeholder="2499.99"
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="create-asset-location"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Location
                  </label>
                  <input
                    id="create-asset-location"
                    type="text"
                    value={createLocation}
                    onChange={(e) => setCreateLocation(e.target.value)}
                    placeholder="e.g. HQ - Floor 3"
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {isCreating ? 'Creating...' : 'Save Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Asset Modal */}
      {editingAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-asset-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-lg max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-blue-600" />
                <h3 id="edit-asset-modal-title" className="text-base font-bold text-slate-900">
                  Edit Asset — {editingAsset.tag}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingAsset(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close edit asset modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditAsset} className="p-6 space-y-4" noValidate>
              {editModalError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editModalError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Asset ID (Immutable)
                  </label>
                  <input
                    type="text"
                    value={editingAsset.tag}
                    disabled
                    className="w-full px-3.5 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm font-mono text-slate-600 cursor-not-allowed"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="edit-asset-name"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Asset Name
                  </label>
                  <input
                    id="edit-asset-name"
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-asset-serial"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Serial Number
                  </label>
                  <input
                    id="edit-asset-serial"
                    type="text"
                    value={editSerialNo}
                    onChange={(e) => setEditSerialNo(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-service-tag"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Service Tag{' '}
                    <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="edit-service-tag"
                    type="text"
                    value={editServiceTag}
                    onChange={(e) => setEditServiceTag(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-asset-tag"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Asset Tag{' '}
                    <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="edit-asset-tag"
                    type="text"
                    value={editAssetTag}
                    onChange={(e) => setEditAssetTag(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-asset-category"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Category
                  </label>
                  <select
                    id="edit-asset-category"
                    value={editCategoryId}
                    onChange={(e) => setEditCategoryId(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {categories.map((cat) => (
                      <option key={cat.id} value={String(cat.id)}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="edit-asset-date"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Purchase Date
                  </label>
                  <input
                    id="edit-asset-date"
                    type="date"
                    value={editPurchaseDate}
                    onChange={(e) => setEditPurchaseDate(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-asset-cost"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Cost (₹)
                  </label>
                  <input
                    id="edit-asset-cost"
                    type="number"
                    step="0.01"
                    min="0"
                    value={editCost}
                    onChange={(e) => setEditCost(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-asset-location"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Location
                  </label>
                  <input
                    id="edit-asset-location"
                    type="text"
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingAsset(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {isUpdating ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Retire Asset Confirmation Modal */}
      {retiringAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="retire-asset-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-lg max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Archive className="w-5 h-5 text-amber-600" />
                <h3 id="retire-asset-modal-title" className="text-base font-bold text-slate-900">
                  Retire Asset — {retiringAsset.tag}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRetiringAsset(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close retire modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {retireModalError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{retireModalError}</span>
                </div>
              )}

              <p className="text-sm text-slate-600">
                Are you sure you want to retire{' '}
                <strong className="text-slate-900">{retiringAsset.name}</strong> (
                <span className="font-mono text-xs">{retiringAsset.tag}</span>)?
              </p>

              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                <div>
                  <span className="font-semibold text-slate-900">Serial Number:</span>{' '}
                  {retiringAsset.serial_no}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Current Status:</span>{' '}
                  {retiringAsset.status}
                </div>
                <div className="pt-1 text-slate-500">
                  Retired assets are never hard-deleted and remain in history and reports, but can
                  no longer be edited or assigned.
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRetiringAsset(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isRetiring}
                  onClick={handleConfirmRetire}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {isRetiring ? 'Retiring...' : 'Confirm Retire'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Asset Modal (FR-7) */}
      {assigningAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-asset-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-lg max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-600" />
                <h3 id="assign-asset-modal-title" className="text-base font-bold text-slate-900">
                  Assign Asset — {assigningAsset.tag}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAssigningAsset(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close assign modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAssignAsset} className="p-6 space-y-4" noValidate>
              {assignModalError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{assignModalError}</span>
                </div>
              )}

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
                Assigning <strong className="text-slate-900">{assigningAsset.name}</strong> (
                <span className="font-mono">{assigningAsset.serial_no}</span>) will transition its
                status to <strong className="text-blue-700">ASSIGNED</strong>.
              </div>

              <div>
                <label
                  htmlFor="assign-employee-select"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Assign to Employee
                </label>
                <select
                  id="assign-employee-select"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="">Select an employee...</option>
                  {directoryUsers.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.name} ({u.email}) — {u.role}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="assign-date-input"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Assignment Date
                </label>
                <input
                  id="assign-date-input"
                  type="date"
                  value={assignedOnDate}
                  onChange={(e) => setAssignedOnDate(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAssigningAsset(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAssigning}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {isAssigning ? 'Assigning...' : 'Confirm Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Open Maintenance Modal for AVAILABLE assets (FR-10, FR-11) */}
      {maintainingAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="open-maint-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-lg max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-amber-700" />
                <h3
                  id="open-maint-modal-title"
                  className="text-base font-bold text-slate-900"
                >
                  Open Maintenance — {maintainingAsset.tag}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMaintainingAsset(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close maintenance modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleOpenMaintenance} className="p-6 space-y-4" noValidate>
              {maintModalError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{maintModalError}</span>
                </div>
              )}

              <p className="text-sm text-slate-600">
                Sending{' '}
                <strong className="text-slate-900">{maintainingAsset.name}</strong> to{' '}
                <span className="font-semibold text-amber-800">IN_MAINTENANCE</span>. It
                cannot be assigned until the maintenance record is closed.
              </p>

              <div>
                <label
                  htmlFor="maint-opened-on"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Opened On
                </label>
                <input
                  id="maint-opened-on"
                  type="date"
                  value={maintOpenedOn}
                  onChange={(e) => setMaintOpenedOn(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="maint-description"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Description *
                </label>
                <textarea
                  id="maint-description"
                  rows={3}
                  value={maintDescription}
                  onChange={(e) => setMaintDescription(e.target.value)}
                  placeholder="Describe the issue or work required..."
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="maint-cost"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Estimated Cost (optional)
                </label>
                <input
                  id="maint-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={maintCost}
                  onChange={(e) => setMaintCost(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Final cost and resolution can be updated when closing maintenance.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setMaintainingAsset(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isOpeningMaint}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {isOpeningMaint ? 'Opening...' : 'Send to Maintenance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Return Asset Modal (FR-8) */}
      {returningAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="return-asset-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-lg max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <CornerDownLeft className="w-5 h-5 text-blue-600" />
                <h3 id="return-asset-modal-title" className="text-base font-bold text-slate-900">
                  Return Asset — {returningAsset.tag}
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

            <form onSubmit={handleReturnAsset} className="p-6 space-y-4" noValidate>
              {returnModalError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{returnModalError}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="return-reason-select"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Return Reason
                </label>
                <select
                  id="return-reason-select"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value as ReturnReason)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="OTHER">OTHER (Back to AVAILABLE)</option>
                  <option value="EMPLOYEE_LEFT">EMPLOYEE_LEFT (Offboarding)</option>
                  <option value="REPLACEMENT">REPLACEMENT</option>
                  <option value="IN_MAINTENANCE">IN_MAINTENANCE (Needs Repair)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="return-date-input"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Return Date
                </label>
                <input
                  id="return-date-input"
                  type="date"
                  value={returnedOnDate}
                  onChange={(e) => setReturnedOnDate(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {returnReason === 'IN_MAINTENANCE' && (
                <div>
                  <label
                    htmlFor="return-maint-desc"
                    className="block text-sm font-medium text-slate-900 mb-1"
                  >
                    Reason for Maintenance *
                  </label>
                  <textarea
                    id="return-maint-desc"
                    rows={3}
                    value={returnMaintDescription}
                    onChange={(e) => setReturnMaintDescription(e.target.value)}
                    placeholder="Describe why this asset needs maintenance..."
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Cost and resolution are entered later when closing maintenance.
                  </p>
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
                  {isReturning ? 'Processing...' : 'Confirm Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Asset Detail & History Drawer / Modal (FR-9) */}
      {historyAssetId !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-labelledby="asset-history-drawer-title"
        >
          <div className="bg-white border-l border-slate-200 shadow-xl max-w-2xl w-full h-full flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-blue-600" />
                <h3
                  id="asset-history-drawer-title"
                  className="text-base font-bold text-slate-900"
                >
                  Asset Detail & History
                  {historyData?.asset ? ` — ${historyData.asset.tag}` : ''}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setHistoryAssetId(null);
                  setHistoryData(null);
                }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close history drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {historyError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{historyError}</span>
                </div>
              )}

              {isHistoryLoading ? (
                <p className="text-sm text-slate-600 py-8 text-center">
                  Loading asset history...
                </p>
              ) : (
                historyData && (
                  <>
                    {/* Asset Summary Card */}
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                      <div>
                        <span className="text-slate-500 block">Tag</span>
                        <span className="font-mono font-bold text-blue-600 text-sm">
                          {historyData.asset.tag}
                        </span>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          {decodeAssetTag(
                            historyData.asset.tag,
                            historyData.asset.category_name ?? undefined,
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Asset Name</span>
                        <span className="font-semibold text-slate-900 text-sm">
                          {historyData.asset.name}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Status</span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border mt-0.5 ${getAssetStatusBadgeClasses(
                            historyData.asset.status,
                          )}`}
                        >
                          {historyData.asset.status}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Serial Number</span>
                        <span className="font-mono text-slate-900">
                          {historyData.asset.serial_no}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Location</span>
                        <span className="text-slate-900">{historyData.asset.location}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Cost</span>
                        <span className="font-semibold text-slate-900">
                          ₹{Number(historyData.asset.cost).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>

                    {/* Assignment History */}
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 mb-2">
                        Assignment History ({historyData.assignments.length})
                      </h4>
                      {historyData.assignments.length === 0 ? (
                        <div className="p-4 rounded-xl border border-slate-200 text-xs text-slate-600 bg-white">
                          No assignments recorded for this asset yet.
                        </div>
                      ) : (
                        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
                                <th className="py-2.5 px-4">Employee</th>
                                <th className="py-2.5 px-4">Assigned On</th>
                                <th className="py-2.5 px-4">Returned On</th>
                                <th className="py-2.5 px-4">Reason</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {historyData.assignments.map((a) => (
                                <tr key={a.id}>
                                  <td className="py-2.5 px-4">
                                    <div className="font-semibold text-slate-900">
                                      {a.user_name ?? `User #${a.user_id}`}
                                    </div>
                                    <div className="text-slate-500">{a.user_email}</div>
                                  </td>
                                  <td className="py-2.5 px-4 text-slate-700">{a.assigned_on}</td>
                                  <td className="py-2.5 px-4">
                                    {a.returned_on ? (
                                      <span className="text-slate-700">{a.returned_on}</span>
                                    ) : (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                                        Active Hold
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-4 text-slate-600">
                                    {a.return_reason ?? '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Maintenance History */}
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 mb-2">
                        Maintenance History ({historyData.maintenance_records.length})
                      </h4>
                      {historyData.maintenance_records.length === 0 ? (
                        <div className="p-4 rounded-xl border border-slate-200 text-xs text-slate-600 bg-white">
                          No maintenance records logged for this asset.
                        </div>
                      ) : (
                        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
                                <th className="py-2.5 px-4">Description</th>
                                <th className="py-2.5 px-4">Opened</th>
                                <th className="py-2.5 px-4">Closed</th>
                                <th className="py-2.5 px-4">Cost</th>
                                <th className="py-2.5 px-4 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {historyData.maintenance_records.map((m) => (
                                <tr key={m.id}>
                                  <td className="py-2.5 px-4 font-medium text-slate-900">
                                    {m.description}
                                  </td>
                                  <td className="py-2.5 px-4 text-slate-600">{m.opened_on}</td>
                                  <td className="py-2.5 px-4">
                                    {m.closed_on ? (
                                      <span className="text-slate-700">{m.closed_on}</span>
                                    ) : (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                                        Open
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-4 text-slate-700">
                                    {m.cost !== null && m.cost !== undefined
                                      ? `₹${Number(m.cost).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                      : '—'}
                                  </td>
                                  <td className="py-2.5 px-4 text-right">
                                    {!m.closed_on && (
                                      <button
                                        type="button"
                                        onClick={() => handleCloseMaintenanceFromDrawer(m.id)}
                                        className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                                      >
                                        Close Maintenance
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )
              )}
            </div>
          </div>
        </div>
      )}

      <BulkImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        userRole={user?.role ?? 'ASSET_MANAGER'}
        allowedTabs={['assets']}
        initialTab="assets"
        onImportSuccess={(_tab, summaryMessage) => {
          setToastSuccess(summaryMessage);
          fetchAssets();
          fetchCategories();
        }}
      />
    </div>
  );
};
