import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getReportSchema, runReport, runReportDrilldown, listSavedReports, createSavedReport,
  updateSavedReport, deleteSavedReport, getJobRoles, shareSavedReport, unshareSavedReport,
  downloadReportPdf, downloadReportCandidatesCsv,
} from '../api/client'
import type { ReportConfig, ReportRunResult, ReportDrilldownResult, SavedReport } from '../api/client'
import CandidateDrilldownTable from '../components/Reports/CandidateDrilldownTable'
import ShareReportModal from '../components/Reports/ShareReportModal'
import { useConfirm } from '../components/shared/ConfirmDialog'
import { EyeTracker } from '../components/shared/EyeTracker'

const EMPTY_CONFIG: ReportConfig = { dimensions: [], metrics: [], filters: {} }

export default function Reports() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const [config, setConfig] = useState<ReportConfig>(EMPTY_CONFIG)
  const [result, setResult] = useState<ReportRunResult | null>(null)
  const [activeReportId, setActiveReportId] = useState<number | null>(null)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [reportName, setReportName] = useState('')
  const [drilldown, setDrilldown] = useState<ReportDrilldownResult | null>(null)
  const [drilldownContext, setDrilldownContext] = useState('')
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  const { data: schema } = useQuery({ queryKey: ['reports', 'schema'], queryFn: getReportSchema })
  const { data: savedReports = [] } = useQuery({ queryKey: ['reports', 'saved'], queryFn: listSavedReports })
  const { data: jobRoles = [] } = useQuery({ queryKey: ['job-roles'], queryFn: getJobRoles })

  const activeReport = savedReports.find((r) => r.id === activeReportId)

  // Guards against out-of-order responses: switching reports bumps this
  // token, so a slow request for the *previous* report can never overwrite
  // what's on screen once a newer request has been kicked off.
  const runTokenRef = useRef(0)

  const drilldownMut = useMutation({
    mutationFn: (vars: { cfg: ReportConfig; dimensionValues: Record<string, string> }) =>
      runReportDrilldown({ ...vars.cfg, dimension_values: vars.dimensionValues }),
  })

  const runMut = useMutation({
    mutationFn: (cfg: ReportConfig) => runReport(cfg),
  })

  function runReportFor(cfg: ReportConfig) {
    const token = ++runTokenRef.current
    setResult(null)
    setDrilldown(null)
    setDrilldownContext('')
    runMut.mutate(cfg, {
      onSuccess: (data) => {
        if (runTokenRef.current !== token) return // a newer report was loaded meanwhile
        setResult(data)
        drilldownMut.mutate({ cfg, dimensionValues: {} }, {
          onSuccess: (dd) => {
            if (runTokenRef.current !== token) return
            setDrilldown(dd)
          },
        })
      },
    })
  }

  const shareMut = useMutation({
    mutationFn: () => shareSavedReport(activeReportId!),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'saved'] })
      if (report.share_token) {
        setShareUrl(`${window.location.origin}/reports/shared/${report.share_token}`)
      }
    },
  })

  const unshareMut = useMutation({
    mutationFn: () => unshareSavedReport(activeReportId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'saved'] })
      setShareUrl(null)
    },
  })

  const saveMut = useMutation({
    mutationFn: () =>
      activeReportId
        ? updateSavedReport(activeReportId, reportName, config)
        : createSavedReport(reportName, config),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'saved'] })
      setActiveReportId(report.id)
      setShowSaveModal(false)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteSavedReport(id),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'saved'] })
      if (deletedId === activeReportId) {
        setActiveReportId(null)
        setConfig(EMPTY_CONFIG)
        setResult(null)
        setDrilldown(null)
      }
    },
  })

  function loadReport(report: SavedReport) {
    setActiveReportId(report.id)
    setConfig(report.config)
    setShareUrl(null)
    runReportFor(report.config)
  }

  function newReport() {
    runTokenRef.current++ // invalidate any in-flight request from the report being left
    setActiveReportId(null)
    setConfig(EMPTY_CONFIG)
    setResult(null)
    setDrilldown(null)
    setShareUrl(null)
  }

  function toggle(list: string[], key: string): string[] {
    return list.includes(key) ? list.filter((k) => k !== key) : [...list, key]
  }

  function drilldownIntoRow(dimensions: Record<string, string>) {
    const token = runTokenRef.current
    setDrilldownContext(Object.entries(dimensions).map(([k, v]) => `${k}=${v}`).join(', '))
    drilldownMut.mutate({ cfg: config, dimensionValues: dimensions }, {
      onSuccess: (dd) => {
        if (runTokenRef.current !== token) return
        setDrilldown(dd)
      },
    })
  }

  // Editing dimensions/metrics/filters by hand invalidates the on-screen
  // result until the user reruns — but loading a saved report already
  // reruns explicitly via runReportFor, so this doesn't fight that.
  useEffect(() => { setResult(null); setDrilldown(null) }, [config])

  // Deep-link support: `?id=<reportId>` loads and auto-runs that saved report,
  // so a saved report can be shared as a direct link within the app.
  useEffect(() => {
    const idParam = searchParams.get('id')
    if (idParam && activeReportId == null) {
      const found = savedReports.find((r) => String(r.id) === idParam)
      if (found) loadReport(found)
    }
  }, [searchParams, savedReports])

  // Keep the URL's `id` param in sync with the active report, without
  // fighting the effect above (this one only reacts to activeReportId).
  useEffect(() => {
    if (activeReportId != null) {
      setSearchParams({ id: String(activeReportId) }, { replace: true })
    } else if (searchParams.get('id')) {
      setSearchParams({}, { replace: true })
    }
  }, [activeReportId])

  return (
    <div className="flex h-full min-h-[calc(100vh-6rem)]">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 border-r border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <button
          onClick={newReport}
          className="w-full bg-accent hover:bg-accent-700 text-white text-sm font-medium rounded-lg py-2 transition-colors"
        >
          + New Report
        </button>
        <div className="space-y-1">
          {savedReports.map((r) => (
            <div
              key={r.id}
              className={`group flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer text-sm transition-colors ${
                activeReportId === r.id
                  ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
              }`}
              onClick={() => loadReport(r)}
            >
              <span className="truncate">{r.name}</span>
              <button
                onClick={async (e) => {
                  e.stopPropagation()
                  const ok = await confirm({
                    title: `Delete "${r.name}"?`,
                    description: 'This saved report and its share link (if any) will be permanently removed. This cannot be undone.',
                    confirmLabel: 'Delete',
                    intent: 'danger',
                  })
                  if (ok) deleteMut.mutate(r.id)
                }}
                className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-danger transition-opacity"
              >✕</button>
            </div>
          ))}
          {savedReports.length === 0 && (
            <p className="text-xs text-gray-400 px-3 py-4 text-center">No saved reports yet.</p>
          )}
        </div>
      </aside>

      {/* Builder + results */}
      <main className="flex-1 p-6 space-y-6 overflow-y-auto">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Custom Reports</h1>
          <div className="flex items-center gap-1 bg-white/40 dark:bg-gray-800/40 px-2 py-1 rounded-full border border-gray-200/60 dark:border-gray-700/60 shadow-xs" title="Interactive Cursor Eye">
            <EyeTracker size={22} pupilSize={9} borderColor="#534AB7" pupilColor="#1e1b4b" />
            <EyeTracker size={22} pupilSize={9} borderColor="#534AB7" pupilColor="#1e1b4b" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Dimensions</h2>
            <div className="space-y-1.5">
              {schema?.dimensions.map((d) => (
                <label key={d.key} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={config.dimensions.includes(d.key)}
                    onChange={() => setConfig((c) => ({ ...c, dimensions: toggle(c.dimensions, d.key) }))}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Metrics</h2>
            <div className="space-y-1.5">
              {schema?.metrics.map((m) => (
                <label key={m.key} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={config.metrics.includes(m.key)}
                    onChange={() => setConfig((c) => ({ ...c, metrics: toggle(c.metrics, m.key) }))}
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Filters</h2>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Job Role</label>
              <select
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                value={(config.filters.job_role_id as number | undefined) ?? ''}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  filters: { ...c.filters, job_role_id: e.target.value ? Number(e.target.value) : undefined },
                }))}
              >
                <option value="">All roles</option>
                {jobRoles.map((jr) => (
                  <option key={jr.id} value={jr.id}>{jr.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Stage</label>
              <select
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                value={(config.filters.stage as string | undefined) ?? ''}
                onChange={(e) => setConfig((c) => ({
                  ...c,
                  filters: { ...c.filters, stage: e.target.value || undefined },
                }))}
              >
                <option value="">Any stage</option>
                {['applied', 'screening', 'coding', 'interview', 'offer', 'hired', 'rejected'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => runReportFor(config)}
            disabled={runMut.isPending || (config.dimensions.length === 0 && config.metrics.length === 0)}
            className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {runMut.isPending ? 'Running…' : 'Run Report'}
          </button>
          <button
            onClick={() => { setReportName(activeReportId ? savedReports.find((r) => r.id === activeReportId)?.name ?? '' : ''); setShowSaveModal(true) }}
            disabled={config.dimensions.length === 0 && config.metrics.length === 0}
            className="text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            Save Report
          </button>
          <button
            onClick={() => downloadReportPdf(activeReportId, config, activeReport?.name)}
            disabled={!result}
            className="text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            Download PDF
          </button>
          <button
            onClick={() => downloadReportCandidatesCsv(activeReportId, config, activeReport?.name)}
            disabled={!result}
            className="text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            Download CSV
          </button>
          <button
            onClick={() => shareMut.mutate()}
            disabled={activeReportId == null || shareMut.isPending}
            title={activeReportId == null ? 'Save this report first to share it' : undefined}
            className="text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            Share
          </button>
          {runMut.isError && <span className="text-xs text-red-500">Failed to run report</span>}
        </div>

        {result && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                  {config.dimensions.map((d) => <th key={d} className="px-4 py-2 font-medium">{d}</th>)}
                  {config.metrics.map((m) => <th key={m} className="px-4 py-2 font-medium">{m}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {result.rows.map((row, i) => (
                  <tr
                    key={i}
                    onClick={() => drilldownIntoRow(row.dimensions)}
                    className="text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-accent-100/50 dark:hover:bg-gray-800"
                  >
                    {config.dimensions.map((d) => <td key={d} className="px-4 py-2">{row.dimensions[d]}</td>)}
                    {config.metrics.map((m) => <td key={m} className="px-4 py-2">{row.metrics[m]}</td>)}
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr><td className="px-4 py-6 text-center text-gray-400" colSpan={config.dimensions.length + config.metrics.length}>No data for this selection.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {result && (
          <CandidateDrilldownTable
            candidates={drilldown?.candidates ?? []}
            total={drilldown?.total ?? 0}
            isLoading={drilldownMut.isPending}
            contextLabel={drilldownContext}
          />
        )}
      </main>

      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-3">Save Report</h2>
            <input
              autoFocus
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="Report name"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40 mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending || !reportName.trim()}
                className="flex-1 bg-accent hover:bg-accent-700 disabled:opacity-50 text-white font-semibold rounded-lg py-2 text-sm transition-colors"
              >
                {saveMut.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {shareUrl != null && (
        <ShareReportModal
          shareUrl={shareUrl}
          onClose={() => setShareUrl(null)}
          onRevoke={() => unshareMut.mutate()}
          isRevoking={unshareMut.isPending}
          onDownloadPdf={() => downloadReportPdf(activeReportId, config, activeReport?.name)}
          onDownloadCsv={() => downloadReportCandidatesCsv(activeReportId, config, activeReport?.name)}
        />
      )}
    </div>
  )
}
