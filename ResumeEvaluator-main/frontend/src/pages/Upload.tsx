import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../store/useAppStore'
import type { QueuedFile, DetectedSection } from '../store/useAppStore'
import { uploadResume, uploadZip, getResumes, deleteResume, deleteAllResumes, archiveResume, reparseAllCandidates, bulkDeleteResumes, bulkArchiveResumes, API_BASE_URL, getJobRoles, runEvaluation } from '../api/client'
import type { UploadResponse, ZipUploadResponse, ParseSettings, JobRole } from '../api/client'

import { useConfirm } from '../components/shared/ConfirmDialog'
import StatusBadge from '../components/StatusBadge'
import UploadZone from '../components/UploadZone'
import EmailTemplatesPanel from '../components/Configure/EmailTemplatesPanel'
import { getInitials } from '../lib/utils'



const SECTION_COLORS: Record<string, string> = {
  summary: '#534AB7',
  skills: '#1D9E75',
  projects: '#EF9F27',
  education: '#E24B4A',
  experience: '#3B82F6',
  certifications: '#8B5CF6',
}

export default function Upload() {
  const queryClient = useQueryClient()
  const { uploadQueue: queue, setUploadQueue: setQueue, showToast } = useAppStore()
  const role = useAppStore((s) => s.role)
  const isAdmin = role === 'admin'
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [zipSummary, setZipSummary] = useState<ZipUploadResponse | null>(null)
  const [zipUploading, setZipUploading] = useState(false)
  const [evaluatedOpen, setEvaluatedOpen] = useState(true)
  const [templatesOpen, setTemplatesOpen] = useState(true)

  // ── Inbound Email History ──────────────────────────────────────────────────
  const [settings, setSettings] = useState<ParseSettings>({
    ocrFallback: true,
    stripHeaders: true,
    detectTables: false,
    multilingualNlp: false,
  })

  // ── Persistence: Fetch stored resumes ──────────────────────────────────────
  const { data: storedResumes, isLoading: isLoadingStored, isError: isErrorStored, refetch: refetchStored } = useQuery({
    queryKey: ['resumes'],
    queryFn: getResumes,
  })

  const confirm = useConfirm()

  const [resumeSearch, setResumeSearch] = useState('')
  const reparseAllMut = useMutation({
    mutationFn: reparseAllCandidates,
    onSuccess: (data) => {
      showToast(`Re-parsed ${data.total} candidates — ${data.updated} name(s) updated.`, 'success')
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
    },
    onError: () => showToast('Re-parse failed.', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteResume,
    onMutate: async (resumeId: number) => {
      await queryClient.cancelQueries({ queryKey: ['resumes'] })
      const prev = queryClient.getQueryData(['resumes'])
      queryClient.setQueryData(['resumes'], (old: any) =>
        Array.isArray(old) ? old.filter((r: any) => r.resume_id !== resumeId) : old
      )
      return { prev }
    },
    onSuccess: () => {
      showToast('Resume deleted successfully', 'success')
    },
    onError: (_err, _id, context: any) => {
      if (context?.prev) queryClient.setQueryData(['resumes'], context.prev)
      showToast('Failed to delete resume. It might be linked to other records.', 'error')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
    },
  })

  const deleteAllResumesMutation = useMutation({
    mutationFn: deleteAllResumes,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
      showToast('All resumes deleted successfully', 'success')
    },
    onError: () => {
      showToast('Failed to delete all resumes.', 'error')
    },
  })

  const archiveMutation = useMutation({
    mutationFn: archiveResume,
    onMutate: async (resumeId: number) => {
      await queryClient.cancelQueries({ queryKey: ['resumes'] })
      const prev = queryClient.getQueryData(['resumes'])
      queryClient.setQueryData(['resumes'], (old: any) =>
        Array.isArray(old) ? old.filter((r: any) => r.resume_id !== resumeId) : old
      )
      return { prev }
    },
    onSuccess: () => {
      showToast('Resume archived successfully', 'success')
    },
    onError: (_err, _id, context: any) => {
      if (context?.prev) queryClient.setQueryData(['resumes'], context.prev)
      showToast('Failed to archive resume.', 'error')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
    },
  })

  // ── Bulk selection state & mutations ──────────────────────────────────────
  const [selectedResumes, setSelectedResumes] = useState<Set<number>>(new Set())
  const [localSortKey, setLocalSortKey] = useState<'name' | 'experience' | 'grad_year'>('name')
  const [localSortDir, setLocalSortDir] = useState<'asc' | 'desc'>('asc')
  const [filterLevels, setFilterLevels] = useState<string[]>([])
  const [filterLocations, setFilterLocations] = useState<string[]>([])
  const [filterJobId, setFilterJobId] = useState<number | null>(null)

  function toggleLevel(v: string) {
    setFilterLevels((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])
  }
  function toggleLoc(v: string) {
    setFilterLocations((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])
  }
  const [showEvalModal, setShowEvalModal] = useState(false)
  const [evalRoleId, setEvalRoleId] = useState<number | null>(null)
  const [evalMsg, setEvalMsg] = useState<string | null>(null)

  const { data: jobRoles } = useQuery<JobRole[]>({
    queryKey: ['job-roles'],
    queryFn: getJobRoles,
  })

  const evaluateSelectedMut = useMutation({
    mutationFn: ({ roleId, resumeIds }: { roleId: number; resumeIds: number[] }) =>
      runEvaluation(roleId, resumeIds),
    onSuccess: (data) => {
      setEvalMsg(`Queued ${data.queued_count} resume(s) for evaluation.`)
      setSelectedResumes(new Set())
      setShowEvalModal(false)
      setTimeout(() => setEvalMsg(null), 4000)
    },
    onError: (err: any) => {
      setEvalMsg(err?.response?.data?.detail ?? 'Evaluation failed.')
    },
  })

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: number[]) => bulkDeleteResumes(ids),
    onSuccess: () => {
      setSelectedResumes(new Set())
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
      showToast('Selected resumes deleted successfully', 'success')
    },
    onError: () => showToast('Bulk delete failed.', 'error'),
  })

  const bulkArchiveMut = useMutation({
    mutationFn: (ids: number[]) => bulkArchiveResumes(ids),
    onSuccess: () => {
      setSelectedResumes(new Set())
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
      showToast('Selected resumes archived successfully', 'success')
    },
    onError: () => showToast('Bulk archive failed.', 'error'),
  })

  function toggleResumeSelect(id: number) {
    setSelectedResumes((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleSelectAllToggle(filteredIds: number[]) {
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedResumes.has(id))
    if (allSelected) {
      setSelectedResumes(new Set())
    } else {
      setSelectedResumes(new Set(filteredIds))
    }
  }

  // Refs for folder / multi-file bulk pickers
  const folderInputRef = useRef<HTMLInputElement>(null)


  // Removed nameInputs and emailInputs since auto-upload uses file data directly
  const sseRefs = useRef<Record<number, EventSource>>({})

  const uploadMut = useMutation({
    mutationFn: ({ file, name, email }: { file: File; name: string; email: string }) =>
      uploadResume(file, name, email, settings),
    onSuccess: (res: UploadResponse, variables) => {
      const latestQueue = useAppStore.getState().uploadQueue
      const idx = latestQueue.findIndex((q) => q.file === variables.file)
      if (idx === -1) return
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      updateQueue(idx, {
        resumeId: res.resume_id,
        candidateEmail: res.candidate_email ?? '',
        candidateName: res.candidate_name,
        stage: 'Upload complete',
        progress: 30,
      })
      subscribeSse(res.resume_id, idx)
    },
    onError: (err: any, variables) => {
      const latestQueue = useAppStore.getState().uploadQueue
      const idx = latestQueue.findIndex((q) => q.file === variables.file)
      // Extract readable message from the server response
      const serverMsg =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        'Upload failed'
      const displayMsg = typeof serverMsg === 'string' ? serverMsg : JSON.stringify(serverMsg)
      setUploadError(displayMsg)
      if (idx !== -1) updateQueue(idx, { status: 'error', stage: displayMsg.slice(0, 60), progress: 0 })
    },
  })

  const zipUploadMut = useMutation({
    mutationFn: (file: File) => uploadZip(file, settings),
    onMutate: () => setZipUploading(true),
    onSuccess: (data: ZipUploadResponse) => {
      setZipSummary(data)
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
      showToast(
        `${data.parsed_count} resume(s) parsed, ${data.duplicate_count} duplicate(s), ${data.error_count} error(s).`,
        data.error_count > 0 ? 'error' : 'success'
      )
    },
    onError: (err: any) => {
      const serverMsg = err?.response?.data?.detail || err?.message || 'ZIP upload failed'
      setUploadError(typeof serverMsg === 'string' ? serverMsg : JSON.stringify(serverMsg))
    },
    onSettled: () => setZipUploading(false),
  })

  function updateQueue(idx: number, patch: Partial<QueuedFile>) {
    setQueue((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)))
  }

  function removeFromQueue(idx: number) {
    setQueue((prev) => {
      const item = prev[idx]
      if (item?.resumeId && sseRefs.current[item.resumeId]) {
        sseRefs.current[item.resumeId].close()
        delete sseRefs.current[item.resumeId]
      }
      return prev.filter((_, i) => i !== idx)
    })
    setActiveIdx((prev) => {
      if (prev === null) return null
      if (prev === idx) return null
      if (prev > idx) return prev - 1
      return prev
    })
  }

  function subscribeSse(resumeId: number, idx: number) {
    // Same origin: EventSource sends the suite session cookie.
    const es = new EventSource(`${API_BASE_URL}/upload/${resumeId}/progress`, { withCredentials: true })
    sseRefs.current[resumeId] = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as {
          pct: number
          stage: string
          sections?: DetectedSection[]
        }
        // "waiting" means the progress store is empty (different worker process)
        // — ignore it so we don't regress progress back to 0
        if (data.stage === 'waiting') return
        const isDone = data.stage === 'done' || data.pct >= 100
        updateQueue(idx, {
          progress: data.pct,
          stage: data.stage,
          status: isDone ? 'done' : 'parsing',
          sections: data.sections,
        })
        if (isDone) {
          es.close()
        }
      } catch (_) {
        // ignore parse errors
      }
    }
    es.onerror = () => {
      // subscribeSse is only called after a successful 201 upload response.
      // SSE failure means progress tracking was lost (e.g. different worker),
      // but the file was already parsed — mark as done, not error.
      setQueue((prev) => {
        const item = prev[idx]
        if (!item || item.status === 'done') return prev
        return prev.map((it, i) =>
          i === idx ? { ...it, status: 'done', stage: 'Processed', progress: 100 } : it
        )
      })
      es.close()
    }
  }

  useEffect(() => {
    return () => {
      Object.values(sseRefs.current).forEach((es) => es.close())
    }
  }, [])

  function handleFiles(files: File[]) {
    const zipFiles = files.filter((f) => f.name.toLowerCase().endsWith('.zip'))
    const resumeFiles = files.filter((f) => !f.name.toLowerCase().endsWith('.zip'))

    zipFiles.forEach((f) => {
      setZipSummary(null)
      zipUploadMut.mutate(f)
    })

    if (resumeFiles.length === 0) return

    const startIdx = queue.length
    const newItems: QueuedFile[] = resumeFiles.map((f) => ({
      file: f,
      candidateName: f.name.replace(/\.[^.]+$/, ''),
      candidateEmail: '',
      progress: 5,
      stage: 'Uploading…',
      status: 'parsing',
    }))
    setQueue((prev) => [...prev, ...newItems])
    setActiveIdx(startIdx)

    // Automatically trigger uploads
    resumeFiles.forEach((f) => {
      uploadMut.mutate({
        file: f,
        name: f.name.replace(/\.[^.]+$/, ''),
        email: ''
      })
    })
  }

  const activeSections = activeIdx !== null ? queue[activeIdx]?.sections ?? [] : []

  function toggleSetting(key: keyof ParseSettings) {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function isDocx(filename: string) {
    return filename.endsWith('.docx') || filename.endsWith('.doc')
  }

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* ── Left Panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-4 p-6 overflow-y-auto">

        {/* Manual Resume Upload */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Manual Resume Upload</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            Upload files or folders from your local machine to parse and extract resume details.
          </p>
          <UploadZone
            onFiles={handleFiles}
            onFolderClick={() => folderInputRef.current?.click()}
          />
        </div>

        {/* ZIP batch upload progress / summary */}
        {zipUploading && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-600 dark:text-gray-300">Extracting and parsing archive…</p>
          </div>
        )}
        {zipSummary && !zipUploading && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">ZIP Batch Result</h2>
              <button onClick={() => setZipSummary(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none">×</button>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
              {zipSummary.parsed_count} resume{zipSummary.parsed_count !== 1 ? 's' : ''} parsed, {zipSummary.duplicate_count} duplicate{zipSummary.duplicate_count !== 1 ? 's' : ''} detected
              {zipSummary.error_count > 0 && <>, <span className="text-danger font-medium">{zipSummary.error_count} error{zipSummary.error_count !== 1 ? 's' : ''}</span></>}
              {zipSummary.skipped_count > 0 && <> ({zipSummary.skipped_count} non-resume file{zipSummary.skipped_count !== 1 ? 's' : ''} skipped)</>}
            </p>
            {zipSummary.error_count > 0 && (
              <ul className="text-xs text-danger-800 dark:text-red-300 space-y-0.5 max-h-32 overflow-y-auto">
                {zipSummary.items.filter((i) => i.status === 'error').map((i, idx) => (
                  <li key={idx}>{i.filename}: {i.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Error banner */}
        {uploadError && (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
            <span className="text-red-500 text-lg shrink-0">⚠</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-0.5">Upload Error</p>
              <p className="text-xs text-red-600 dark:text-red-400 break-all">{uploadError}</p>
            </div>
            <button
              onClick={() => setUploadError(null)}
              className="text-red-400 hover:text-red-600 text-lg leading-none shrink-0"
            >×</button>
          </div>
        )}

        {/* Upload queue */}
        {queue.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Upload Queue</h2>
            <ul className="space-y-3">
              {queue.map((item, idx) => (
                <li
                  key={idx}
                  className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                    activeIdx === idx
                      ? 'border-accent bg-accent-100/30 dark:bg-accent-900/30'
                      : 'border-gray-100 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                  onClick={() => setActiveIdx(idx)}
                >
                  <div className="flex items-start gap-3">
                    {/* File icon */}
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-accent-100 dark:bg-accent-900 shrink-0">
                      <span className="text-[9px] font-bold text-accent">
                        {isDocx(item.file.name) ? 'DOC' : 'PDF'}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{item.file.name}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <StatusBadge status={item.status} />
                          {/* Remove button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              removeFromQueue(idx)
                            }}
                            title="Remove from queue"
                            className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors text-sm leading-none"
                          >
                            ×
                          </button>
                        </div>
                      </div>

                      {/* Progress bar */}
                      {item.progress > 0 && (
                        <>
                          <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mb-1">
                            <span>{item.stage}</span>
                            <span>{item.progress}%</span>
                          </div>
                          <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-1.5 rounded-full transition-all duration-500"
                              style={{
                                width: `${item.progress}%`,
                                backgroundColor:
                                  item.status === 'error'
                                    ? '#E24B4A'
                                    : item.status === 'done'
                                    ? '#1D9E75'
                                    : '#534AB7',
                              }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Hidden folder input (triggered from UploadZone) */}
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          multiple
          accept=".pdf,.docx,.doc"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).filter((f) =>
              /\.(pdf|docx|doc)$/i.test(f.name)
            )
            if (files.length) handleFiles(files)
            if (folderInputRef.current) folderInputRef.current.value = ''
          }}
        />

        {/* Run Evaluation moved to Job Roles (Configure) page */}

        {/* ── Bulk CSV / Excel Import (disabled) ─────────────────────────── */}
        {/* <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Bulk Candidate Import</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            Import candidate metadata from a CSV or Excel file. Columns: name, email, phone, linkedin_url, github_url, portfolio_url, current_title, experience_level
          </p>
          ... (CSV/Excel import UI hidden)
        </div> */}

        {/* ── Stored Resumes / Evaluated Resumes ── */}
        {(
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mt-4">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setEvaluatedOpen((v) => !v)}
                className="flex items-center gap-2 text-left"
              >
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9l-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <h2 className="font-semibold text-gray-800 dark:text-gray-100">Evaluated Resumes</h2>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${evaluatedOpen ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {evaluatedOpen && <div className="flex items-center gap-2 flex-wrap">
                {/* Search */}
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={resumeSearch}
                    onChange={(e) => setResumeSearch(e.target.value)}
                    placeholder="Search name or email…"
                    className="pl-8 pr-7 py-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 w-44 placeholder-gray-400"
                  />
                  {resumeSearch && (
                    <button onClick={() => setResumeSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm leading-none">×</button>
                  )}
                </div>

                {/* Filter by Job Role */}
                <select
                  value={filterJobId ?? ''}
                  onChange={(e) => {
                    setFilterJobId(e.target.value ? Number(e.target.value) : null)
                    if (e.target.value) setEvalRoleId(Number(e.target.value))
                  }}
                  className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 max-w-[180px]"
                >
                  <option value="">All Jobs</option>
                  {(jobRoles ?? []).map((r) => (
                    <option key={r.id} value={r.id}>{r.title}</option>
                  ))}
                </select>

                {/* Experience Level — multi-select */}
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                  {[
                    { v: 'entry', l: 'Entry/Intern' },
                    { v: 'junior', l: 'Junior' },
                    { v: 'mid', l: 'Mid' },
                    { v: 'senior', l: 'Senior' },
                    { v: 'executive', l: 'Exec' },
                  ].map(({ v, l }) => (
                    <button
                      key={v}
                      onClick={() => toggleLevel(v)}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all ${
                        filterLevels.includes(v)
                          ? 'bg-white dark:bg-gray-700 text-accent shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>

                {/* Location multi-select from data */}
                {(() => {
                  const locs = [...new Set((storedResumes ?? []).map((r) => r.candidate_location).filter(Boolean) as string[])].sort()
                  return locs.length > 0 ? (
                    <div className="flex items-center gap-1 flex-wrap max-w-xs">
                      {locs.map((loc) => (
                        <button
                          key={loc}
                          onClick={() => toggleLoc(loc)}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                            filterLocations.includes(loc)
                              ? 'bg-accent text-white border-accent'
                              : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:border-accent/50'
                          }`}
                        >
                          📍 {loc}
                        </button>
                      ))}
                    </div>
                  ) : null
                })()}

                {(filterJobId || filterLevels.length > 0 || filterLocations.length > 0 || resumeSearch) && (
                  <button
                    onClick={() => { setFilterJobId(null); setFilterLevels([]); setFilterLocations([]); setResumeSearch('') }}
                    className="text-xs text-danger hover:underline"
                  >
                    Clear filters
                  </button>
                )}

                <span className="text-xs text-gray-400">{storedResumes?.length || 0} Total</span>
                {(() => {
                  const filteredIds = (storedResumes ?? []).filter((r) => {
                    if (resumeSearch) {
                      const q = resumeSearch.toLowerCase()
                      if (!r.candidate_name?.toLowerCase().includes(q) && !r.candidate_email?.toLowerCase().includes(q)) return false
                    }
                    if (filterLevels.length > 0) {
                      const lvl = r.candidate_experience_level ?? 'entry'
                      if (!filterLevels.includes(lvl)) return false
                    }
                    if (filterLocations.length > 0) {
                      const loc = (r.candidate_location ?? '').toLowerCase()
                      if (!filterLocations.some((fl) => loc.includes(fl.toLowerCase()))) return false
                    }
                    return true
                  }).map((r) => r.resume_id)
                  return filteredIds.length > 0 ? (
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={filteredIds.every((id) => selectedResumes.has(id))}
                        onChange={() => handleSelectAllToggle(filteredIds)}
                        className="w-3.5 h-3.5 text-accent border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded focus:ring-accent cursor-pointer"
                      />
                      <span>Select All ({filteredIds.length})</span>
                    </label>
                  ) : null
                })()}
                <button
                  onClick={() => reparseAllMut.mutate()}
                  disabled={reparseAllMut.isPending}
                  title="Re-extract names and graduation years from all stored resumes using the latest parser"
                  className="text-xs px-2 py-1 rounded border border-accent/30 text-accent hover:bg-accent-50 disabled:opacity-50 transition-colors"
                >
                  {reparseAllMut.isPending ? 'Parsing…' : '↺ Re-parse Names'}
                </button>
                {(storedResumes?.length ?? 0) > 0 && (
                  <button
                    onClick={async () => {
                      if (await confirm({
                        title: 'Delete All Resumes?',
                        description: 'Are you sure you want to permanently delete ALL resumes and all evaluation data? This cannot be undone.',
                        intent: 'danger'
                      })) {
                        deleteAllResumesMutation.mutate()
                      }
                    }}
                    disabled={deleteAllResumesMutation.isPending}
                    className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                    title="Permanently delete all resumes and their evaluation data"
                  >
                    {deleteAllResumesMutation.isPending ? 'Deleting all...' : '🗑 Delete All'}
                  </button>
                )}
              </div>}
            </div>

            {evaluatedOpen && (
              isLoadingStored ? (
                <div className="py-12 text-center text-gray-400 text-sm">Loading stored resumes...</div>
              ) : isErrorStored ? (
                <div className="py-12 text-center text-sm space-y-2">
                  <p className="text-danger-800 dark:text-red-300 font-medium">Failed to load stored resumes.</p>
                  <button
                    onClick={() => refetchStored()}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : (storedResumes?.length ?? 0) === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm border-2 border-dashed border-gray-50 dark:border-gray-800 rounded-lg">
                  No resumes found in the database.
                </div>
              ) : (() => {
                const filteredResumes = (storedResumes ?? []).filter((r) => {
                  if (resumeSearch) {
                    const q = resumeSearch.toLowerCase()
                    if (!r.candidate_name?.toLowerCase().includes(q) && !r.candidate_email?.toLowerCase().includes(q)) return false
                  }
                  if (filterLevels.length > 0) {
                    const lvl = r.candidate_experience_level ?? 'entry'
                    if (!filterLevels.includes(lvl)) return false
                  }
                  if (filterLocations.length > 0) {
                    const loc = (r.candidate_location ?? '').toLowerCase()
                    if (!filterLocations.some((fl) => loc.includes(fl.toLowerCase()))) return false
                  }
                  return true
                }).sort((a, b) => {
                  let av: string | number, bv: string | number
                  if (localSortKey === 'experience') {
                    av = (a as any).candidate_years_experience ?? 0
                    bv = (b as any).candidate_years_experience ?? 0
                  } else if (localSortKey === 'grad_year') {
                    av = (a as any).candidate_graduation_year ?? 0
                    bv = (b as any).candidate_graduation_year ?? 0
                  } else {
                    av = (a.candidate_name ?? '').toLowerCase()
                    bv = (b.candidate_name ?? '').toLowerCase()
                  }
                  if (av < bv) return localSortDir === 'asc' ? -1 : 1
                  if (av > bv) return localSortDir === 'asc' ? 1 : -1
                  return 0
                })
                return (
                  <>
                    {/* Local sort controls */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="text-xs text-gray-400 dark:text-gray-500">Sort:</span>
                      {([
                        { key: 'name', label: 'Name' },
                        { key: 'experience', label: 'Experience ↕' },
                        { key: 'grad_year', label: 'Grad Year ↕' },
                      ] as const).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => {
                            if (localSortKey === key) setLocalSortDir((d) => d === 'asc' ? 'desc' : 'asc')
                            else { setLocalSortKey(key); setLocalSortDir(key === 'name' ? 'asc' : 'desc') }
                          }}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            localSortKey === key
                              ? 'bg-accent text-white border-accent'
                              : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-accent'
                          }`}
                        >
                          {label}{localSortKey === key ? (localSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </button>
                      ))}
                      {evalMsg && (
                        <span className="text-xs font-medium text-success ml-2">{evalMsg}</span>
                      )}
                    </div>

                    {/* Bulk action toolbar */}
                    {selectedResumes.size > 0 && (
                      <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-accent-100 dark:bg-accent-900 border border-accent-300 rounded-xl flex-wrap">
                        <span className="text-sm font-semibold text-accent-700 dark:text-accent-300">
                          {selectedResumes.size} selected
                        </span>
                        <button
                          onClick={() => setShowEvalModal(true)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-700 transition-colors"
                        >
                          Evaluate Selected
                        </button>
                        <button
                          onClick={() => bulkArchiveMut.mutate([...selectedResumes])}
                          disabled={bulkArchiveMut.isPending || bulkDeleteMut.isPending}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-warning-100 text-warning-800 border border-warning hover:bg-warning-200 disabled:opacity-50 transition-colors"
                        >
                          {bulkArchiveMut.isPending ? 'Archiving…' : 'Archive Selected'}
                        </button>
                        <button
                          onClick={async () => {
                            if (await confirm({
                              title: 'Delete Selected Resumes?',
                              description: `Permanently delete ${selectedResumes.size} resume(s) and all their evaluation data? This cannot be undone.`,
                              intent: 'danger'
                            })) {
                              bulkDeleteMut.mutate([...selectedResumes])
                            }
                          }}
                          disabled={bulkDeleteMut.isPending || bulkArchiveMut.isPending}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-danger-100 text-danger-800 border border-danger hover:bg-danger-200 disabled:opacity-50 transition-colors"
                        >
                          {bulkDeleteMut.isPending ? 'Deleting…' : 'Delete Selected'}
                        </button>
                        <button
                          onClick={() => setSelectedResumes(new Set())}
                          className="ml-auto text-xs text-accent dark:text-accent-300 hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredResumes.map((resume) => (
                        <div
                          key={resume.resume_id}
                          className={`p-3 rounded-lg border transition-all flex items-center justify-between group ${
                            selectedResumes.has(resume.resume_id)
                              ? 'border-accent/50 bg-accent-100/30 dark:bg-accent-900/30'
                              : 'border-gray-100 dark:border-gray-800 hover:border-accent/30'
                          }`}
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <input
                              type="checkbox"
                              checked={selectedResumes.has(resume.resume_id)}
                              onChange={() => toggleResumeSelect(resume.resume_id)}
                              className="w-4 h-4 text-accent border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded focus:ring-accent cursor-pointer shrink-0"
                            />
                            <div className="w-9 h-9 rounded bg-accent-50 dark:bg-[#2A265F] flex items-center justify-center shrink-0">
                              <span className="text-accent font-bold text-xs">{getInitials(resume.candidate_name)}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                                {resume.candidate_name}
                              </p>
                              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                                {resume.candidate_email || 'No email'}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button
                              onClick={() => archiveMutation.mutate(resume.resume_id)}
                              disabled={archiveMutation.isPending}
                              className="p-2 text-gray-300 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded transition-colors"
                              title="Archive (soft delete) — hides from pool, data preserved"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                              </svg>
                            </button>
                            <button
                              onClick={async () => {
                                if (await confirm({
                                  title: 'Delete Resume?',
                                  description: 'Permanently delete this resume and all its evaluation data? This cannot be undone.',
                                  intent: 'danger'
                                })) {
                                  deleteMutation.mutate(resume.resume_id)
                                }
                              }}
                              disabled={deleteMutation.isPending}
                              className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                              title="Hard delete — permanently removes all data"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )
              })()
            )}
          </div>
        )}

        {/* ── Email Templates (admin only) ────────────────────── */}
        {isAdmin && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 mt-4">
            <button
              onClick={() => setTemplatesOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors rounded-xl"
            >
              <svg className="w-5 h-5 text-accent shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Email Templates</h2>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${templatesOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {templatesOpen && (
              <div className="px-5 pb-5">
                <EmailTemplatesPanel />
              </div>
            )}
          </div>
        )}
      </div>


      {/* ── Right Panel ────────────────────────────────────────── */}
      <aside className="w-72 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col overflow-y-auto p-4 gap-4">
        {/* Section Detector */}
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 text-sm">Section Detector</h3>
          {activeSections.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {activeIdx === null
                ? 'Select a file to see detected sections.'
                : 'Sections will appear after parsing completes.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {activeSections.map((sec, i) => {
                const color = SECTION_COLORS[sec.label.toLowerCase()] ?? '#6B7280'
                return (
                  <li key={i} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize flex-1">
                      {sec.label}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      L{sec.line_start}–{sec.line_end}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <hr className="border-gray-100 dark:border-gray-700" />

        {/* Parse Settings */}
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 text-sm">Parse Settings</h3>
          <ul className="space-y-2.5">
            {(
              [
                { key: 'ocrFallback', label: 'OCR fallback', desc: 'Use OCR for scanned PDFs' },
                { key: 'stripHeaders', label: 'Strip headers/footers', desc: 'Remove page margins text' },
                { key: 'detectTables', label: 'Detect tables', desc: 'Extract structured tables' },
                { key: 'multilingualNlp', label: 'Multilingual NLP', desc: 'Support non-English resumes' },
              ] as const
            ).map(({ key, label, desc }) => (
              <li key={key} className="flex items-start gap-2.5">
                <button
                  role="switch"
                  aria-checked={settings[key]}
                  onClick={() => toggleSetting(key)}
                  className={`relative w-9 h-5 rounded-full shrink-0 mt-0.5 transition-colors ${
                    settings[key] ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      settings[key] ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Active file info */}
        {activeIdx !== null && queue[activeIdx] && (
          <>
            <hr className="border-gray-100 dark:border-gray-700" />
            <div>
              <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-2 text-sm">Selected File</h3>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0">
                  <span className="text-xs text-white font-bold">
                    {getInitials(queue[activeIdx].candidateName || queue[activeIdx].file.name)}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">
                    {queue[activeIdx].candidateName || queue[activeIdx].file.name}
                  </p>
                  {queue[activeIdx].candidateEmail && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{queue[activeIdx].candidateEmail}</p>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Size: {(queue[activeIdx].file.size / 1024).toFixed(1)} KB
              </p>
            </div>
          </>
        )}
      </aside>

      {/* ── Evaluate Selected Modal ─────────────────────────────── */}
      {showEvalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setShowEvalModal(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-sm w-full p-6 border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 dark:text-gray-100 text-base mb-1">Evaluate Selected Resumes</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Score <strong>{selectedResumes.size}</strong> selected resume{selectedResumes.size !== 1 ? 's' : ''} against a job role.
            </p>
            {filterJobId && evalRoleId === filterJobId && (
              <div className="mb-3 flex items-center gap-2 bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300 text-xs font-medium px-3 py-2 rounded-lg">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Job pre-selected from your active filter
              </div>
            )}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">Select Job Role</label>
              <select
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={evalRoleId ?? ''}
                onChange={(e) => setEvalRoleId(Number(e.target.value) || null)}
              >
                <option value="">— Choose a role —</option>
                {(jobRoles ?? []).map((r: JobRole) => (
                  <option key={r.id} value={r.id}>{r.title}{r.intake_paused ? ' (paused)' : ''}</option>
                ))}
              </select>
              {(jobRoles ?? []).length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                  No job roles yet.{' '}
                  <a href="/configure" className="underline font-medium hover:text-accent">Create one in Configure</a>
                  {' '}or{' '}
                  <a href="/jobs/new" className="underline font-medium hover:text-accent">Post a Job from JD</a>.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (evalRoleId) {
                    evaluateSelectedMut.mutate({ roleId: evalRoleId, resumeIds: [...selectedResumes] })
                  }
                }}
                disabled={!evalRoleId || evaluateSelectedMut.isPending}
                className="flex-1 bg-accent hover:bg-accent-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                {evaluateSelectedMut.isPending ? 'Queuing…' : 'Start Evaluation'}
              </button>
              <button
                onClick={() => setShowEvalModal(false)}
                className="px-4 py-2.5 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
