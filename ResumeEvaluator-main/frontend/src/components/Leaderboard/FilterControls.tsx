import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useConfirm } from '../shared/ConfirmDialog'
import { useAnchoredPanel } from '../../lib/hooks'

interface FilterControlsProps {
  nameSearch: string
  setNameSearch: (v: string) => void
  gradYearFrom: number | ''
  setGradYearFrom: (v: number | '') => void
  gradYearTo: number | ''
  setGradYearTo: (v: number | '') => void
  expFrom: number | ''
  setExpFrom: (v: number | '') => void
  expTo: number | ''
  setExpTo: (v: number | '') => void
  scoreFrom: number | ''
  setScoreFrom: (v: number | '') => void
  scoreTo: number | ''
  setScoreTo: (v: number | '') => void
  filterStatus: string
  setFilterStatus: (v: string) => void
  filterLevels: string[]
  toggleFilterLevel: (v: string) => void
  filterLocations: string[]
  toggleFilterLocation: (v: string) => void
  availableLocations: string[]
  locationSearch: string
  setLocationSearch: (v: string) => void
  sortKey: string
  setSortKey: (v: any) => void
  selectedJobRoleId: number | null
  evalStatus: any
  queuedCount: number
  isAdmin: boolean
  bulkEmailMut: any
  bulkEmailMsg: string | null
  deleteAllMutation: any
  pauseMut: any
  resumeMut: any
  blindMode: boolean
  onToggleBlindMode: () => void
  autoShortlistMut: any
  reclassifyMut: any
  reclassifyMsg: string | null
  exportCSV: () => void
  downloadResultsCsv: (id: any, status: any, search?: any) => void
  onExportAllHtml: () => Promise<void>
  onPrintAll: () => Promise<void>
  onExportToSharePoint?: (format: 'pdf' | 'csv' | 'xlsx') => Promise<void>
  refreshResults: () => void
  isFetching?: boolean
  items?: any[]
}

// --- Icon helpers ---
function IconFilter() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
    </svg>
  )
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function IconRefresh() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function IconEmail() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

function IconDownload() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}

function IconPdf() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM9.5 17.5c-.3 0-.5-.1-.7-.3-.2-.2-.3-.5-.3-.8 0-.5.2-1.1.6-1.9-.4.1-.7.2-1 .2-.6 0-1.1-.2-1.4-.5-.3-.3-.4-.7-.4-1.2 0-.5.2-.9.5-1.2.3-.3.7-.5 1.2-.5.3 0 .6.1.9.3V11c0-.3.1-.5.3-.7.2-.2.5-.3.7-.3.3 0 .5.1.7.3.2.2.3.5.3.7v.8c.2-.1.5-.2.8-.2.5 0 .9.2 1.2.5.3.3.5.7.5 1.2 0 .5-.1.9-.4 1.2-.3.3-.7.5-1.3.5-.3 0-.6-.1-.9-.2.4.7.6 1.3.6 1.8 0 .4-.1.7-.3.9-.2.2-.5.3-.8.3z" />
    </svg>
  )
}

function IconCloudUpload() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M12 12v9m0-9l-3 3m3-3l3 3" />
    </svg>
  )
}

function IconGrid() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

// PDF export: print page as PDF using window.print with a simplified layout
function exportPDF(callback?: () => void) {
  if (callback) callback()
  setTimeout(() => {
    window.print()
  }, 150)
}

// Full report: export as HTML blob
function exportFullReport(items?: any[]) {
  const rows = items && items.length > 0 ? items : []
  const content = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Candidates Report</title>
<style>
  body { font-family: -apple-system,sans-serif; font-size:12px; color:#111; padding:24px; }
  h1 { font-size:18px; margin-bottom:4px; }
  .meta { font-size:11px; color:#666; margin-bottom:16px; }
  table { width:100%; border-collapse:collapse; }
  th { background:#534AB7; color:#fff; padding:7px 10px; text-align:left; font-size:11px; white-space:nowrap; }
  td { padding:6px 10px; border-bottom:1px solid #eee; vertical-align:top; }
  tr:nth-child(even) td { background:#f9f9ff; }
  .score-high { color:#1D9E75; font-weight:700; }
  .score-mid  { color:#EF9F27; font-weight:700; }
  .score-low  { color:#E24B4A; font-weight:700; }
  .tag { display:inline-block; font-size:10px; padding:1px 6px; border-radius:20px; background:#EEEDFE; color:#3C3489; margin:1px; }
  .flag { color:#E24B4A; font-size:10px; }
</style>
</head>
<body>
<h1>Candidate Evaluation Report</h1>
<p class="meta">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; Total candidates: ${rows.length}</p>
${rows.length > 0 ? `
<table>
<thead><tr>
  <th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Score</th>
  <th>Skills Matched</th><th>Matched Skill Names</th><th>Role</th>
  <th>Level</th><th>Stage</th><th>Status</th><th>GitHub</th><th>Evaluated At</th>
</tr></thead>
<tbody>
${rows.map((it: any, i: number) => {
  const score = Math.round(it.total_score ?? 0)
  const scoreClass = score >= 75 ? 'score-high' : score >= 50 ? 'score-mid' : 'score-low'
  const skillTags = (it.matched_skill_names ?? []).map((s: string) => `<span class="tag">${s}</span>`).join('')
  const flags = it.needs_manual_review ? '<span class="flag">⚠ Review</span>' : ''
  const ghUrl = it.github_url ? `<a href="${it.github_url}">${it.github_url}</a>` : '—'
  const evalDate = it.evaluated_at ? new Date(it.evaluated_at).toLocaleDateString() : '—'
  return `<tr>
  <td>${i + 1}</td>
  <td>${it.candidate_name ?? ''} ${flags}</td>
  <td>${it.candidate_email ?? ''}</td>
  <td>${it.candidate_phone ?? '—'}</td>
  <td class="${scoreClass}">${score}</td>
  <td>${it.skills_matched ?? 0}/${it.skills_total ?? 0}</td>
  <td>${skillTags || '—'}</td>
  <td>${it.job_role_title ?? '—'}</td>
  <td>${it.candidate_experience_level ?? '—'}</td>
  <td>${it.candidate_stage ?? 'applied'}</td>
  <td>${it.status ?? '—'}</td>
  <td>${ghUrl}</td>
  <td>${evalDate}</td>
</tr>`}).join('')}
</tbody>
</table>` : '<p>No candidates to display.</p>'}
</body></html>`
  const blob = new Blob([content], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `report_${new Date().toISOString().slice(0, 10)}.html`
  a.click()
  URL.revokeObjectURL(url)
}

export default function FilterControls({
  nameSearch,
  setNameSearch,
  gradYearFrom,
  setGradYearFrom,
  gradYearTo,
  setGradYearTo,
  expFrom,
  setExpFrom,
  expTo,
  setExpTo,
  scoreFrom,
  setScoreFrom,
  scoreTo,
  setScoreTo,
  filterStatus,
  setFilterStatus,
  filterLevels,
  toggleFilterLevel,
  filterLocations,
  toggleFilterLocation,
  availableLocations,
  locationSearch,
  setLocationSearch,
  sortKey,
  setSortKey,
  selectedJobRoleId,
  evalStatus,
  queuedCount,
  isAdmin,
  bulkEmailMut,
  bulkEmailMsg,
  deleteAllMutation,
  pauseMut,
  resumeMut,
  blindMode,
  onToggleBlindMode,
  autoShortlistMut,
  reclassifyMut,
  reclassifyMsg,
  exportCSV,
  downloadResultsCsv,
  onExportAllHtml,
  onPrintAll,
  onExportToSharePoint,
  refreshResults,
  isFetching,
  items,
}: FilterControlsProps) {
  const confirm = useConfirm()
  // Satisfy noUnusedLocals
  if (false as boolean) {
    console.log(sortKey, setSortKey, exportCSV, exportPDF, exportFullReport, items)
  }

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportingAll, setExportingAll] = useState(false)
  const [exportingToSharePoint, setExportingToSharePoint] = useState<'pdf' | 'csv' | 'xlsx' | null>(null)
  const filtersRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const filtersPanelRef = useRef<HTMLDivElement>(null)
  const exportPanelRef = useRef<HTMLDivElement>(null)
  const filtersPos = useAnchoredPanel(filtersOpen, filtersRef)
  const exportPos = useAnchoredPanel(exportOpen, exportRef)

  // Count active filters for badge (status shown inline, so not counted here)
  const activeFilterCount = [
    filterLevels.length > 0,
    filterLocations.length > 0 || locationSearch !== '',
    gradYearFrom !== '' || gradYearTo !== '',
    expFrom !== '' || expTo !== '',
    scoreFrom !== '' || scoreTo !== '',
  ].filter(Boolean).length

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node
      if (
        filtersRef.current && !filtersRef.current.contains(target) &&
        !(filtersPanelRef.current && filtersPanelRef.current.contains(target))
      ) {
        setFiltersOpen(false)
      }
      if (
        exportRef.current && !exportRef.current.contains(target) &&
        !(exportPanelRef.current && exportPanelRef.current.contains(target))
      ) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function clearAllFilters() {
    setFilterStatus('')
    filterLevels.forEach(() => {})  // cleared via toggle below
    ;(filterLevels.slice()).forEach((v) => toggleFilterLevel(v))
    ;(filterLocations.slice()).forEach((v) => toggleFilterLocation(v))
    setLocationSearch('')
    setGradYearFrom('')
    setGradYearTo('')
    setExpFrom('')
    setExpTo('')
    setScoreFrom('')
    setScoreTo('')
  }

  const isPaused = evalStatus?.paused
  const canPause = selectedJobRoleId != null

  // Advanced filter count (excludes status which is shown inline)
  const advancedFilterCount = [
    filterLevels.length > 0,
    filterLocations.length > 0 || locationSearch !== '',
    gradYearFrom !== '' || gradYearTo !== '',
    expFrom !== '' || expTo !== '',
    scoreFrom !== '' || scoreTo !== '',
  ].filter(Boolean).length

  return (
    <div className="space-y-2.5">

      {/* ── Row 1: Search + Status filter + actions ── */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* Search bar */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-full pl-9 pr-7 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder-gray-400 dark:placeholder-gray-500 transition-shadow"
          />
          {nameSearch && (
            <button onClick={() => setNameSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-base leading-none">×</button>
          )}
        </div>

        {/* ── Status filter — always visible ── */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          {[
            { value: '', label: 'All' },
            { value: 'shortlisted', label: 'Shortlisted', dot: '#1D9E75' },
            { value: 'review', label: 'Review', dot: '#EF9F27' },
            { value: 'rejected', label: 'Rejected', dot: '#E24B4A' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilterStatus(opt.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all select-none ${
                filterStatus === opt.value
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {opt.dot && (
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: opt.dot }} />
              )}
              {opt.label}
            </button>
          ))}
        </div>

        {/* ── More Filters dropdown (level, location, score, dates) ── */}
        <div className="relative" ref={filtersRef}>
          <button
            onClick={() => { setFiltersOpen((v) => !v); setExportOpen(false) }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all select-none
              ${filtersOpen
                ? 'bg-accent text-white border-accent shadow-md shadow-accent/25'
                : advancedFilterCount > 0
                  ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300 border-accent-300/50 hover:border-accent/60'
                  : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
          >
            <IconFilter />
            More Filters
            {advancedFilterCount > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[18px] px-1 py-0.5 text-[10px] font-bold rounded-full leading-none
                ${filtersOpen ? 'bg-white/25 text-white' : 'bg-accent text-white'}`}
              >
                {advancedFilterCount}
              </span>
            )}
            <IconChevron open={filtersOpen} />
          </button>

          {/* More Filters Dropdown Panel */}
          {filtersOpen && filtersPos && createPortal(
            <div
              ref={filtersPanelRef}
              style={{ top: filtersPos.top, left: filtersPos.left }}
              className="fixed z-[100] w-[280px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl shadow-gray-300/50 dark:shadow-black/60 p-3.5 space-y-3.5 animate-in fade-in slide-in-from-top-1 duration-150"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-2.5 border-b border-gray-100 dark:border-gray-800">
                <span className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                  <IconFilter />
                  More Filters
                </span>
                <div className="flex items-center gap-2">
                  {advancedFilterCount > 0 && (
                    <button
                      onClick={clearAllFilters}
                      className="text-xs font-semibold text-danger hover:text-[#c23c3c] transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                  <button
                    onClick={() => setFiltersOpen(false)}
                    title="Close"
                    className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Experience Level — multi-select */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Experience Level</label>
                  {filterLevels.length > 0 && (
                    <button onClick={() => filterLevels.slice().forEach((v) => toggleFilterLevel(v))} className="text-[10px] text-danger hover:underline">Clear</button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {[
                    { value: 'entry', label: 'Entry / Intern' },
                    { value: 'junior', label: 'Junior' },
                    { value: 'mid', label: 'Mid' },
                    { value: 'senior', label: 'Senior' },
                    { value: 'executive', label: 'Exec' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => toggleFilterLevel(opt.value)}
                      className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold border transition-all flex items-center gap-1
                        ${filterLevels.includes(opt.value)
                          ? 'bg-accent text-white border-accent shadow-sm'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-accent/40 hover:text-accent'
                        }`}
                    >
                      {filterLevels.includes(opt.value) && <span className="text-[9px]">✓</span>}
                      {opt.label}
                    </button>
                  ))}
                </div>
                {filterLevels.length === 0 && <p className="text-[10px] text-gray-400">Select one or more levels</p>}
              </div>

              {/* Location — multi-select from data + text search */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Location</label>
                  {(filterLocations.length > 0 || locationSearch) && (
                    <button onClick={() => { filterLocations.slice().forEach((v) => toggleFilterLocation(v)); setLocationSearch('') }} className="text-[10px] text-danger hover:underline">Clear</button>
                  )}
                </div>
                {/* Known locations from loaded data */}
                {availableLocations.length > 0 ? (
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {availableLocations.map((loc) => (
                      <button
                        key={loc}
                        onClick={() => toggleFilterLocation(loc)}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-all
                          ${filterLocations.includes(loc)
                            ? 'bg-accent text-white border-accent'
                            : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-accent/40'
                          }`}
                      >
                        {filterLocations.includes(loc) && '✓ '}{loc}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-400 italic">No location data yet — locations are extracted when resumes are processed</p>
                )}
                {/* Free-text fallback */}
                <div className="relative">
                  <input
                    type="text"
                    value={locationSearch}
                    onChange={(e) => setLocationSearch(e.target.value)}
                    placeholder="Or search manually…"
                    className="w-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder-gray-400"
                  />
                  {locationSearch && (
                    <button onClick={() => setLocationSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-sm leading-none">×</button>
                  )}
                </div>
              </div>

              {/* Graduation Year Range */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Graduation Year</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={gradYearFrom}
                    onChange={(e) => setGradYearFrom(e.target.value ? Number(e.target.value) : '')}
                    placeholder="From"
                    className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder-gray-400"
                  />
                  <span className="text-xs text-gray-400 shrink-0">–</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={gradYearTo}
                    onChange={(e) => setGradYearTo(e.target.value ? Number(e.target.value) : '')}
                    placeholder="To"
                    className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder-gray-400"
                  />
                  {(gradYearFrom !== '' || gradYearTo !== '') && (
                    <button onClick={() => { setGradYearFrom(''); setGradYearTo('') }} className="shrink-0 text-gray-400 hover:text-red-500 text-sm leading-none transition-colors">×</button>
                  )}
                </div>
              </div>

              {/* Experience Years Range */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Years of Experience</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={expFrom}
                    onChange={(e) => setExpFrom(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Min"
                    className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder-gray-400"
                  />
                  <span className="text-xs text-gray-400 shrink-0">–</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={expTo}
                    onChange={(e) => setExpTo(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Max"
                    className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder-gray-400"
                  />
                  {(expFrom !== '' || expTo !== '') && (
                    <button onClick={() => { setExpFrom(''); setExpTo('') }} className="shrink-0 text-gray-400 hover:text-red-500 text-sm leading-none transition-colors">×</button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {[[0,2,'0–2 yrs'],[3,5,'3–5 yrs'],[6,9,'6–9 yrs'],[10,99,'10+ yrs']].map(([min, max, label]) => (
                    <button
                      key={String(label)}
                      onClick={() => { setExpFrom(min as number); setExpTo(max as number) }}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-all
                        ${expFrom === min && expTo === max
                          ? 'bg-accent text-white border-accent shadow-sm'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-accent/40 hover:text-accent'
                        }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Score Range */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Fit Score Range</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={scoreFrom}
                    onChange={(e) => setScoreFrom(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Min"
                    className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder-gray-400"
                  />
                  <span className="text-xs text-gray-400 shrink-0">–</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={scoreTo}
                    onChange={(e) => setScoreTo(e.target.value ? Number(e.target.value) : '')}
                    placeholder="Max"
                    className="min-w-0 flex-1 border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder-gray-400"
                  />
                  {(scoreFrom !== '' || scoreTo !== '') && (
                    <button onClick={() => { setScoreFrom(''); setScoreTo('') }} className="shrink-0 text-gray-400 hover:text-red-500 text-sm leading-none transition-colors">×</button>
                  )}
                </div>
              </div>

              {/* Active filter chips */}
              {activeFilterCount > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100 dark:border-gray-800">
                  {filterStatus && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[10px] font-semibold border border-accent-300/30">
                      Status: {filterStatus}
                      <button onClick={() => setFilterStatus('')} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  )}
                  {filterLevels.map((v) => (
                    <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[10px] font-semibold border border-accent-300/30">
                      Level: {v}
                      <button onClick={() => toggleFilterLevel(v)} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  ))}
                  {filterLocations.map((v) => (
                    <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[10px] font-semibold border border-accent-300/30">
                      📍 {v}
                      <button onClick={() => toggleFilterLocation(v)} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  ))}
                  {locationSearch && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[10px] font-semibold border border-accent-300/30">
                      📍 "{locationSearch}"
                      <button onClick={() => setLocationSearch('')} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  )}
                  {(gradYearFrom !== '' || gradYearTo !== '') && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[10px] font-semibold border border-accent-300/30">
                      Grad: {gradYearFrom || '…'}–{gradYearTo || '…'}
                      <button onClick={() => { setGradYearFrom(''); setGradYearTo('') }} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  )}
                  {(expFrom !== '' || expTo !== '') && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[10px] font-semibold border border-accent-300/30">
                      Exp: {expFrom || '0'}–{expTo === 99 ? '10+' : (expTo || '…')} yrs
                      <button onClick={() => { setExpFrom(''); setExpTo('') }} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  )}
                  {(scoreFrom !== '' || scoreTo !== '') && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[10px] font-semibold border border-accent-300/30">
                      Score: {scoreFrom || '0'}–{scoreTo || '100'}
                      <button onClick={() => { setScoreFrom(''); setScoreTo('') }} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  )}
                </div>
              )}
            </div>,
            document.body
          )}
        </div>

        {/* ── Email Shortlisted button ── */}
        {isAdmin && selectedJobRoleId && (
          <button
            onClick={async () => {
              if (await confirm({
                title: 'Send Next Steps?',
                description: "Send next-steps email to all shortlisted candidates who haven't received one yet?",
                intent: 'info'
              })) {
                bulkEmailMut.mutate()
              }
            }}
            disabled={bulkEmailMut.isPending}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-success/50 bg-success-100 dark:bg-success-900 text-success-800 dark:text-success-300 hover:bg-success-200 dark:hover:bg-[#0f4035] disabled:opacity-50 transition-colors select-none"
          >
            <IconEmail />
            {bulkEmailMut.isPending ? 'Sending…' : 'Email Shortlisted'}
          </button>
        )}
        {bulkEmailMsg && (
          <span className="text-xs text-success font-medium animate-pulse">{bulkEmailMsg}</span>
        )}

        <button
          onClick={refreshResults}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 transition-colors select-none disabled:opacity-60"
          title="Reload results from server"
        >
          <div className={isFetching ? 'animate-spin' : ''}>
            <IconRefresh />
          </div>
          {isFetching ? 'Updating…' : 'Refresh'}
        </button>

        {/* ── Pause / Resume ── */}
        {canPause && (
          <button
            onClick={() => (isPaused ? resumeMut.mutate() : pauseMut.mutate())}
            disabled={pauseMut.isPending || resumeMut.isPending || (!evalStatus?.in_progress && !evalStatus?.paused)}
            title={
              isPaused
                ? `Resume evaluation${queuedCount > 0 ? ` — ${queuedCount} queued` : ''}`
                : 'Pause evaluation — queued resumes stay held'
            }
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50 select-none
              ${isPaused
                ? 'border-success/50 text-success dark:border-success/50 hover:bg-success-100 dark:hover:bg-[#0a3329]'
                : 'border-amber-300 dark:border-amber-600/50 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
              }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${isPaused ? 'bg-success' : 'bg-amber-400 animate-pulse'}`} />
            {isPaused
              ? (resumeMut.isPending ? 'Resuming…' : 'Resume')
              : (pauseMut.isPending ? 'Pausing…' : 'Pause')
            }
          </button>
        )}

        {/* ── Blind Mode toggle ── */}
        <button
          onClick={onToggleBlindMode}
          title="Mask candidate names/emails to reduce unconscious bias while reviewing"
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors select-none
            ${blindMode
              ? 'bg-accent text-white border-accent'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
        >
          {blindMode ? 'Blind Mode: On' : 'Blind Mode'}
        </button>

        {/* ── Auto-Shortlist ── */}
        {isAdmin && selectedJobRoleId && (
          <button
            onClick={async () => {
              if (await confirm({
                title: 'Auto-Shortlist?',
                description: "Auto-shortlist every fully-scored candidate meeting this role's Min Fit Score threshold?",
                intent: 'info'
              })) {
                autoShortlistMut.mutate()
              }
            }}
            disabled={autoShortlistMut.isPending}
            title="Retroactively shortlist all qualifying candidates for this role (requires Min Fit Score to be set in Configure)"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors select-none"
          >
            {autoShortlistMut.isPending ? 'Applying…' : 'Auto-Shortlist'}
          </button>
        )}

        {/* ── Reclassify Experience Levels ── */}
        {isAdmin && (
          <button
            onClick={async () => {
              if (await confirm({
                title: 'Reclassify Experience Levels?',
                description: 'Recompute experience level (junior/mid/senior/executive) for every candidate from years of experience and graduation year?',
                intent: 'info'
              })) {
                reclassifyMut.mutate()
              }
            }}
            disabled={reclassifyMut.isPending}
            title="Bulk-recompute experience_level for all candidates"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors select-none"
          >
            {reclassifyMut.isPending ? 'Reclassifying…' : 'Reclassify Levels'}
          </button>
        )}
        {reclassifyMsg && (
          <span className="text-xs text-success font-medium animate-pulse">{reclassifyMsg}</span>
        )}

        {/* ── Export Grid (⠿) dropdown ── */}
        <div className="relative ml-auto" ref={exportRef}>
          <button
            onClick={() => { setExportOpen((v) => !v); setFiltersOpen(false) }}
            title="Export options"
            className={`flex items-center justify-center w-9 h-9 rounded-xl border transition-all select-none
              ${exportOpen
                ? 'bg-accent text-white border-accent shadow-md shadow-accent/25'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
          >
            <IconGrid />
          </button>

          {/* Export dropdown */}
          {exportOpen && exportPos && createPortal(
            <div
              ref={exportPanelRef}
              style={{ top: exportPos.top, right: exportPos.right }}
              className="fixed z-[100] w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl shadow-gray-300/50 dark:shadow-black/60 p-2 animate-in fade-in slide-in-from-top-1 duration-150"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800 mb-1">
                <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Export Options</span>
                <button
                  onClick={() => setExportOpen(false)}
                  title="Close"
                  className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <button
                onClick={() => { downloadResultsCsv(selectedJobRoleId, filterStatus || undefined, nameSearch || undefined); setExportOpen(false) }}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-accent-100 dark:hover:bg-accent-900 hover:text-accent-700 dark:hover:text-accent-300 transition-colors group"
              >
                <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 group-hover:bg-accent/10 transition-colors">
                  <IconDownload />
                </span>
                <div className="text-left">
                  <p className="font-semibold text-[13px] leading-tight">Export CSV</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">All records — respects current filters</p>
                </div>
              </button>

              <button
                onClick={() => { downloadResultsCsv(selectedJobRoleId, undefined, undefined); setExportOpen(false) }}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-accent-100 dark:hover:bg-accent-900 hover:text-accent-700 dark:hover:text-accent-300 transition-colors group"
              >
                <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 group-hover:bg-accent/10 transition-colors">
                  <IconDownload />
                </span>
                <div className="text-left">
                  <p className="font-semibold text-[13px] leading-tight">Export All (no filter)</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Every candidate for this role</p>
                </div>
              </button>

              <button
                disabled={exportingAll}
                onClick={async () => {
                  setExportingAll(true)
                  setExportOpen(false)
                  await onPrintAll()
                  setExportingAll(false)
                }}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-danger-100 dark:hover:bg-[#3a1515] hover:text-danger-800 dark:hover:text-danger transition-colors group disabled:opacity-60"
              >
                <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 group-hover:bg-danger/10 transition-colors text-danger">
                  {exportingAll ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : <IconPdf />}
                </span>
                <div className="text-left">
                  <p className="font-semibold text-[13px] leading-tight">Print / Save PDF</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Fetches all records first</p>
                </div>
              </button>

              <button
                disabled={exportingAll}
                onClick={async () => {
                  setExportingAll(true)
                  setExportOpen(false)
                  await onExportAllHtml()
                  setExportingAll(false)
                }}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-success-100 dark:hover:bg-success-900 hover:text-success-800 dark:hover:text-success-300 transition-colors group disabled:opacity-60"
              >
                <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 group-hover:bg-success/10 transition-colors text-success">
                  {exportingAll ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : <IconGrid />}
                </span>
                <div className="text-left">
                  <p className="font-semibold text-[13px] leading-tight">Export Full Report</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">HTML — all records, print as PDF</p>
                </div>
              </button>

              {onExportToSharePoint && (
                <div className="px-3 py-2.5 rounded-xl group">
                  <div className="flex items-center gap-2.5 mb-2">
                    <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-accent">
                      <IconCloudUpload />
                    </span>
                    <div className="text-left">
                      <p className="font-semibold text-[13px] leading-tight text-gray-700 dark:text-gray-300">Save to SharePoint</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Current filters, uploaded to your export folder</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5 pl-9">
                    {(['pdf', 'csv', 'xlsx'] as const).map((fmt) => (
                      <button
                        key={fmt}
                        disabled={exportingToSharePoint !== null}
                        onClick={async () => {
                          setExportingToSharePoint(fmt)
                          await onExportToSharePoint(fmt)
                          setExportingToSharePoint(null)
                        }}
                        className="flex-1 text-[11px] font-semibold uppercase tracking-wide px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-accent hover:text-accent dark:hover:text-accent-300 transition-colors disabled:opacity-50"
                      >
                        {exportingToSharePoint === fmt ? '…' : fmt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Divider + Danger zone */}
              <div className="border-t border-gray-100 dark:border-gray-800 mt-1.5 pt-1.5">
                <button
                  onClick={async () => {
                    if (await confirm({
                      title: 'Clear All Results?',
                      description: 'Clear ALL results for this job role?',
                      intent: 'danger'
                    })) {
                      deleteAllMutation.mutate(selectedJobRoleId!)
                      setExportOpen(false)
                    }
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors group"
                >
                  <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500">
                    <IconTrash />
                  </span>
                  <div className="text-left">
                    <p className="font-semibold text-[13px] leading-tight">Clear All Results</p>
                    <p className="text-[10px] text-red-400/70 mt-0.5">Permanently removes all evaluations</p>
                  </div>
                </button>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>

      {/* ── Active advanced filter chips (level, location, score, dates) ── */}
      {advancedFilterCount > 0 && !filtersOpen && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mr-1">Also filtering:</span>
          {filterLevels.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[11px] font-semibold border border-accent-300/30">
              Level: {v}
              <button onClick={() => toggleFilterLevel(v)} className="ml-0.5 opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          ))}
          {filterLocations.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[11px] font-semibold border border-accent-300/30">
              📍 {v}
              <button onClick={() => toggleFilterLocation(v)} className="ml-0.5 opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          ))}
          {locationSearch && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[11px] font-semibold border border-accent-300/30">
              📍 "{locationSearch}"
              <button onClick={() => setLocationSearch('')} className="ml-0.5 opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          )}
          {(gradYearFrom !== '' || gradYearTo !== '') && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[11px] font-semibold border border-accent-300/30">
              Grad {gradYearFrom || '…'}–{gradYearTo || '…'}
              <button onClick={() => { setGradYearFrom(''); setGradYearTo('') }} className="ml-0.5 opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          )}
          {(expFrom !== '' || expTo !== '') && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[11px] font-semibold border border-accent-300/30">
              Exp {expFrom || '0'}–{expTo === 99 ? '10+' : (expTo || '…')} yrs
              <button onClick={() => { setExpFrom(''); setExpTo('') }} className="ml-0.5 opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          )}
          {(scoreFrom !== '' || scoreTo !== '') && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 text-[11px] font-semibold border border-accent-300/30">
              Score {scoreFrom || '0'}–{scoreTo || '100'}
              <button onClick={() => { setScoreFrom(''); setScoreTo('') }} className="ml-0.5 opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          )}
          <button
            onClick={clearAllFilters}
            className="text-[11px] font-semibold text-danger hover:text-[#c23c3c] transition-colors ml-1"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
