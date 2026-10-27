import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Info, PackagePlus, X } from 'lucide-react';
import { registerMyAssetApi } from '../api/assignments';
import { listCategoriesApi } from '../api/categories';
import { extractErrorMessage } from '../api/client';
import type { AssignedAsset, Category } from '../types';

interface EmployeeAssetRegisterModalProps {
  open: boolean;
  onClose: () => void;
  onRegistered: (asset: AssignedAsset) => void;
}

export const EmployeeAssetRegisterModal: React.FC<EmployeeAssetRegisterModalProps> = ({
  open,
  onClose,
  onRegistered,
}) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [serialNo, setSerialNo] = useState<string>('');
  const [serviceTag, setServiceTag] = useState<string>('');
  const [assetTag, setAssetTag] = useState<string>('');
  const [purchaseDate, setPurchaseDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );
  const [cost, setCost] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const resetForm = useCallback((cats: Category[]) => {
    setName('');
    setCategoryId(cats.length > 0 ? String(cats[0].id) : '');
    setSerialNo('');
    setServiceTag('');
    setAssetTag('');
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setCost('');
    setLocation('');
    setError(null);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Asset name is required');
      return;
    }
    if (!categoryId) {
      setError('Please select a category');
      return;
    }
    if (!serialNo.trim()) {
      setError('Serial number is required');
      return;
    }
    if (!purchaseDate) {
      setError('Purchase date is required');
      return;
    }
    if (cost === '' || Number.isNaN(Number(cost)) || Number(cost) < 0) {
      setError('Cost must be a number greater than or equal to 0');
      return;
    }
    if (!location.trim()) {
      setError('Location is required');
      return;
    }

    setIsSaving(true);
    try {
      const created = await registerMyAssetApi({
        name: name.trim(),
        category_id: Number(categoryId),
        serial_no: serialNo.trim(),
        service_tag: serviceTag.trim() || null,
        asset_tag: assetTag.trim() || null,
        purchase_date: purchaseDate,
        cost: Number(cost),
        location: location.trim(),
      });
      onRegistered(created);
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to register asset'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New Asset Register Modal"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between sticky top-0">
          <div className="flex items-center gap-2.5">
            <PackagePlus className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-bold text-slate-900">New Asset Register</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer"
            aria-label="Close register modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div
            role="note"
            className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 flex items-start gap-2.5"
          >
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800 leading-relaxed">
              Use this when you already have the hardware (e.g. handed off by Admin).
              Saving registers it and adds it to My Assets. After save, edits require
              emailing Admin (
              <a
                href="mailto:admin@tektalis.com"
                className="font-semibold underline underline-offset-2"
              >
                admin@tektalis.com
              </a>
              ).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="emp-reg-name"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                Asset Name
              </label>
              <input
                id="emp-reg-name"
                aria-label="Asset Name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. MacBook Pro 16 M4"
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="emp-reg-category"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                Category
              </label>
              <select
                id="emp-reg-category"
                aria-label="Category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
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
                htmlFor="emp-reg-serial"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                Serial Number
              </label>
              <input
                id="emp-reg-serial"
                aria-label="Serial Number"
                type="text"
                value={serialNo}
                onChange={(e) => setSerialNo(e.target.value)}
                placeholder="e.g. SN-MBP-1001"
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="emp-reg-service-tag"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                Service Tag{' '}
                <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="emp-reg-service-tag"
                aria-label="Service Tag"
                type="text"
                value={serviceTag}
                onChange={(e) => setServiceTag(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="emp-reg-asset-tag"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                Asset Tag{' '}
                <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="emp-reg-asset-tag"
                aria-label="Asset Tag"
                type="text"
                value={assetTag}
                onChange={(e) => setAssetTag(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="emp-reg-date"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                Purchase Date
              </label>
              <input
                id="emp-reg-date"
                aria-label="Purchase Date"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="emp-reg-cost"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                Cost (₹)
              </label>
              <input
                id="emp-reg-cost"
                aria-label="Cost"
                type="number"
                min="0"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="emp-reg-location"
                className="block text-sm font-medium text-slate-900 mb-1"
              >
                Location
              </label>
              <input
                id="emp-reg-location"
                aria-label="Location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. HQ - Floor 3"
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
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
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
            >
              {isSaving ? 'Registering...' : 'Register Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
