import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ClipboardList, Info, X } from 'lucide-react';
import { createAssetRequestApi } from '../api/assetRequests';
import { listCategoriesApi } from '../api/categories';
import { extractErrorMessage } from '../api/client';
import type { AssetRequest, Category } from '../types';

const OTHER_CATEGORY_VALUE = '__OTHER__';

interface EmployeeAssetRequestModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (request: AssetRequest) => void;
}

export const EmployeeAssetRequestModal: React.FC<EmployeeAssetRequestModalProps> = ({
  open,
  onClose,
  onCreated,
}) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [createCategoryValue, setCreateCategoryValue] = useState<string>('');
  const [otherCategoryName, setOtherCategoryName] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);

  const resetForm = useCallback((cats: Category[]) => {
    setCreateCategoryValue(cats.length > 0 ? String(cats[0].id) : '');
    setOtherCategoryName('');
    setReason('');
    setCreateError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const cats = await listCategoriesApi();
        if (cancelled) return;
        setCategories(cats);
        resetForm(cats);
      } catch {
        if (!cancelled) {
          setCategories([]);
          resetForm([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, resetForm]);

  if (!open) {
    return null;
  }

  const isOtherSelected = createCategoryValue === OTHER_CATEGORY_VALUE;

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!reason.trim()) {
      setCreateError('Please describe what you need and why');
      return;
    }
    if (isOtherSelected) {
      if (!otherCategoryName.trim()) {
        setCreateError('Describe the category / item you need (Other)');
        return;
      }
    } else if (!createCategoryValue) {
      setCreateError('Please select a category');
      return;
    }

    setIsCreating(true);
    try {
      const created = await createAssetRequestApi({
        is_other: isOtherSelected,
        category_id: isOtherSelected ? null : Number(createCategoryValue),
        other_category_name: isOtherSelected ? otherCategoryName.trim() : null,
        reason: reason.trim(),
      });
      onCreated(created);
      onClose();
    } catch (err) {
      setCreateError(extractErrorMessage(err, 'Failed to submit asset request'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New Asset Request Modal"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between sticky top-0">
          <div className="flex items-center gap-2.5">
            <ClipboardList className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">New Asset Request</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer"
            aria-label="Close create modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreateSubmit} className="p-6 space-y-4" noValidate>
          {createError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{createError}</span>
            </div>
          )}

          <div
            role="note"
            className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 flex items-start gap-2.5"
          >
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800 leading-relaxed">
              Submit the category and why you need it. Approval confirms the ask —
              Admin may assign an existing asset from the registry, or ask you to
              use New Asset Register if hardware was handed to you. For edits after
              you register, contact Admin (
              <a
                href="mailto:admin@tektalis.com"
                className="font-semibold underline underline-offset-2"
              >
                admin@tektalis.com
              </a>
              ).
            </p>
          </div>

          <div>
            <label
              htmlFor="areq-category"
              className="block text-sm font-medium text-slate-900 mb-1"
            >
              Category
            </label>
            <select
              id="areq-category"
              aria-label="Category"
              value={createCategoryValue}
              onChange={(e) => setCreateCategoryValue(e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={String(cat.id)}>
                  {cat.name}
                </option>
              ))}
              <option value={OTHER_CATEGORY_VALUE}>Other (not in catalogue)</option>
            </select>
          </div>

          {isOtherSelected && (
            <div>
              <label
                htmlFor="areq-other-name"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                What do you need? (category / item)
              </label>
              <input
                id="areq-other-name"
                aria-label="Other Category Name"
                type="text"
                value={otherCategoryName}
                onChange={(e) => setOtherCategoryName(e.target.value)}
                placeholder="e.g. Survey Drone Kit"
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="areq-reason"
              className="block text-sm font-medium text-slate-900 mb-1"
            >
              Reason — what you need and why
            </label>
            <textarea
              id="areq-reason"
              aria-label="Reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the item and why you need it..."
              className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
            >
              {isCreating ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
