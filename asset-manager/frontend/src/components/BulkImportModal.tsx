import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderPlus,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  ASSETS_SAMPLE_CSV,
  downloadAssetsSampleCsv,
  importAssetsCsvApi,
  importAssetsDataApi,
} from '../api/assets';
import { extractErrorMessage } from '../api/client';
import type { AssetBulkImportResponse, UserRole } from '../types';

// TT Suite: people are created only by the global admin in the portal, so this modal imports
// assets only (the Users import and its template are gone).
export type ImportTabType = 'assets';

export const DATA_IMPORTED_EVENT = 'ams:data-imported';

export function notifyDataImported(tab: ImportTabType): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(DATA_IMPORTED_EVENT, { detail: { tab } }),
    );
  }
}

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: UserRole;
  /** Restrict which import options are visible. Defaults to role-based both/assets. */
  allowedTabs?: ImportTabType[];
  initialTab?: ImportTabType;
  onImportSuccess?: (
    tab: ImportTabType,
    summaryMessage: string,
  ) => void;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [assetsTextContent, setAssetsTextContent] = useState<string>('');
  const [assetsExcelBase64, setAssetsExcelBase64] = useState<string>('');
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [assetsResult, setAssetsResult] =
    useState<AssetBulkImportResponse | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const currentText = assetsTextContent;
  const currentExcelBase64 = assetsExcelBase64;

  const setCurrentText = (value: string) => {
    setError(null);
    setAssetsTextContent(value);
    setAssetsExcelBase64('');
    setAssetsResult(null);
  };

  const setCurrentExcel = (base64: string) => {
    setError(null);
    setAssetsExcelBase64(base64);
    setAssetsResult(null);
  };

  const countDataRows = (text: string): number => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.length > 1 ? lines.length - 1 : 0;
  };

  const detectedRows = countDataRows(currentText);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);
    setError(null);

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl =
          typeof event.target?.result === 'string' ? event.target.result : '';
        setCurrentExcel(dataUrl);
      };
      reader.onerror = () => {
        setError('Failed to read the selected Excel file.');
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content =
          typeof event.target?.result === 'string' ? event.target.result : '';
        setCurrentText(content);
      };
      reader.onerror = () => {
        setError('Failed to read the selected file.');
      };
      reader.readAsText(file);
    }
  };

  const handleLoadSampleIntoEditor = () => {
    setSelectedFileName('tektalis_assets_import_template.xlsx');
    setCurrentText(ASSETS_SAMPLE_CSV);
  };

  const handleDownloadSample = async () => {
    try {
      await downloadAssetsSampleCsv('tektalis_assets_import_template.xlsx');
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to download Excel template'));
    }
  };

  const handleRunImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentExcelBase64.trim() && !currentText.trim()) {
      setError(
        'Please upload an Excel file or paste spreadsheet rows before importing.',
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = currentExcelBase64.trim()
        ? await importAssetsDataApi({ excel_base64: currentExcelBase64 })
        : await importAssetsCsvApi(currentText);
      setAssetsResult(res);
      notifyDataImported('assets');
      if (onImportSuccess && res.imported_count > 0) {
        onImportSuccess(
          'assets',
          `Imported ${res.imported_count} of ${res.total_rows} asset(s).`,
        );
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to process import'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeResult = assetsResult;
  const modalTitle = 'Import Assets';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-import-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full p-6 shadow-xl space-y-5 my-8">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3
                id="bulk-import-modal-title"
                className="text-lg font-bold text-slate-900"
              >
                {modalTitle}
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Upload an Excel file to add assets
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 cursor-pointer"
            aria-label="Close import modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Assets Template Columns
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                Required: name, serial_no, category, purchase_date, cost, location. Optional: service_tag, asset_tag, assigned_to_email.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="load-sample-csv-btn"
                onClick={handleLoadSampleIntoEditor}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Load Sample Rows</span>
              </button>
              <button
                type="button"
                data-testid="download-sample-csv-btn"
                onClick={handleDownloadSample}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-blue-600" />
                <span>Download Template</span>
              </button>
            </div>
          </div>

          {(
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                name*
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                serial_no*
              </span>
              <span className="px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200">
                service_tag
              </span>
              <span className="px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200">
                asset_tag
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                category*
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                purchase_date*
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                cost*
              </span>
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                location*
              </span>
              <span className="px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200">
                assigned_to_email
              </span>
            </div>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2.5 text-xs text-red-700"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleRunImport} className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={handleFileChange}
                className="hidden"
                data-testid="csv-file-input"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4 text-blue-600" />
                <span>Choose Excel File</span>
              </button>
              {selectedFileName && (
                <span className="text-xs text-slate-600 font-medium truncate max-w-xs">
                  File:{' '}
                  <strong className="text-slate-900">{selectedFileName}</strong>
                </span>
              )}
            </div>

            <span
              data-testid="detected-rows-badge"
              className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200"
            >
              {currentExcelBase64
                ? 'Excel file attached'
                : `${detectedRows} data row${detectedRows === 1 ? '' : 's'}`}
            </span>
          </div>

          {currentExcelBase64 ? (
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    {selectedFileName || 'Excel file'} ready to import
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Click Import below to validate and import all rows.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCurrentExcel('');
                  setSelectedFileName('');
                }}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline cursor-pointer"
              >
                Clear File
              </button>
            </div>
          ) : (
            <div>
              <label
                htmlFor="csv-content-textarea"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Or paste rows from Excel
              </label>
              <textarea
                id="csv-content-textarea"
                rows={6}
                value={currentText}
                onChange={(e) => setCurrentText(e.target.value)}
                placeholder={ASSETS_SAMPLE_CSV}
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

          {activeResult && (
            <div
              data-testid="import-summary-card"
              className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-sm font-bold text-slate-900">
                    Import Summary
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span className="px-2.5 py-0.5 rounded-md bg-slate-200/70 text-slate-700">
                    Total Rows: {activeResult.total_rows}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Imported: {activeResult.imported_count}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-md border ${
                      activeResult.skipped_count > 0
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    Skipped: {activeResult.skipped_count}
                  </span>
                </div>
              </div>

              {assetsResult &&
                assetsResult.created_categories.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
                      <FolderPlus className="w-3.5 h-3.5" />
                      New Categories:
                    </span>
                    {assetsResult.created_categories.map((catName) => (
                      <span
                        key={catName}
                        className="px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200"
                      >
                        {catName}
                      </span>
                    ))}
                  </div>
                )}

              {activeResult.errors.length > 0 && (
                <div className="border border-amber-200 rounded-lg overflow-hidden bg-white">
                  <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-xs font-semibold text-amber-800">
                    Skipped Rows ({activeResult.errors.length})
                  </div>
                  <div className="max-h-36 overflow-y-auto divide-y divide-slate-100">
                    {activeResult.errors.map((errItem) => (
                      <div
                        key={`${errItem.row}-${errItem.identifier}`}
                        className="px-3 py-2 text-xs flex items-start justify-between gap-3"
                      >
                        <span className="font-mono font-semibold text-slate-700 shrink-0">
                          Row {errItem.row} ({errItem.identifier})
                        </span>
                        <span className="text-red-600 text-right">
                          {errItem.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 cursor-pointer"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="submit-bulk-import-btn"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>
                {isSubmitting ? 'Importing...' : 'Import Assets'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
