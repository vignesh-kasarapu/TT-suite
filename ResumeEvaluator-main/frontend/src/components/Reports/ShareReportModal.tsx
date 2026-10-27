import { useState } from 'react'

interface ShareReportModalProps {
  shareUrl: string
  onClose: () => void
  onRevoke: () => void
  isRevoking: boolean
  onDownloadPdf: () => void
  onDownloadCsv: () => void
}

export default function ShareReportModal({
  shareUrl, onClose, onRevoke, isRevoking, onDownloadPdf, onDownloadCsv,
}: ShareReportModalProps) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard?.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the input is
      // still selectable/readOnly so the user can copy it manually.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-3">Share Report</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Anyone with this link can view a read-only summary and candidate list — no login required.
        </p>
        <div className="flex gap-2 mb-4">
          <input
            readOnly
            value={shareUrl}
            onFocus={(e) => e.target.select()}
            className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          />
          <button
            onClick={copyLink}
            className="text-sm text-white bg-accent hover:bg-accent-700 rounded-lg px-3 py-2 transition-colors whitespace-nowrap"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={onDownloadPdf}
            className="flex-1 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Download PDF
          </button>
          <button
            onClick={onDownloadCsv}
            className="flex-1 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Download CSV
          </button>
        </div>

        <div className="flex justify-between">
          <button
            onClick={onRevoke}
            disabled={isRevoking}
            className="text-sm text-danger hover:underline disabled:opacity-50"
          >
            Revoke link
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
