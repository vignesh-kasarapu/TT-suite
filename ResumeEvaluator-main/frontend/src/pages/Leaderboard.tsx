import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useInfiniteQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query'
import {
  getResults,
  deleteResult,
  deleteAllResults,
  getJobRoles,
  setIntakePause,
  autoApplyShortlist,
  bulkShortlist,
  bulkDelete,
  updateEvaluationStage,
  bulkUpdateStage,
  bulkSendNextSteps,
  downloadResultsCsv,
  reclassifyExperienceLevels,
  getResultsSummary,
  pauseEvaluation,
  resumeEvaluation,
  getEvaluationStatus,
  fetchResumeFileBlob,
  exportResultsToSharePoint,
} from '../api/client'
import type { CandidateResult, CandidateStage, JobRole, ShortlistStatus } from '../api/client'
import { useAppStore } from '../store/useAppStore'

import SummaryCards from '../components/Leaderboard/SummaryCards'
import FilterControls from '../components/Leaderboard/FilterControls'
import CandidateTable from '../components/Leaderboard/CandidateTable'
import ManualEvalPanel from '../components/Leaderboard/ManualEvalPanel'
import BulkEmailComposerModal from '../components/Leaderboard/BulkEmailComposerModal'
import NeedsReviewBuckets from '../components/Leaderboard/NeedsReviewBuckets'
import WeightsSandbox from '../components/Leaderboard/WeightsSandbox'
import type { SandboxWeights } from '../components/Leaderboard/WeightsSandbox'
import ShareLinksModal from '../components/Leaderboard/ShareLinksModal'
import { useConfirm } from '../components/shared/ConfirmDialog'

type SortKey = 'total_score' | 'candidate_name' | 'skills_matched' | 'years_experience' | 'current_title' | 'job_role_title' | 'candidate_location'

const _SECTION_HEADERS = new Set([
  'career objective', 'professional summary', 'work experience',
  'education background', 'educational background', 'skills summary',
  'technical skills', 'core competencies', 'key skills',
  'areas of expertise', 'summary of qualifications', 'personal information',
  'contact information', 'references available', 'about me',
  'profile summary', 'career summary', 'objective statement', 'professional profile',
])

function displayName(name: string, email: string | null | undefined): string {
  if (_SECTION_HEADERS.has(name.toLowerCase())) {
    if (email) return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    return 'Unknown'
  }
  return name
}

const STAGE_LABEL_MAP: Record<string, string> = {
  applied: 'Applied', screening: 'Screening', coding: 'Coding Test',
  interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected',
}

function getComputedStatus(item: CandidateResult): string {
  if (item.filter_stage === 'experience_filtered' || item.filter_stage === 'tfidf_filtered') {
    return 'rejected'
  }
  if (item.needs_manual_review && (item.status === 'done' || item.status === 'pending' || !item.status)) {
    return 'review'
  }
  if (item.status === 'pending') {
    return 'review'
  }
  return item.status || 'done'
}

function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    shortlisted: 'Shortlisted',
    review: 'Needs Review',
    rejected: 'Rejected',
    hired: 'Hired',
    pending: 'On Hold',
    parsing: 'Parsing',
    scoring: 'Scoring',
    done: 'Done',
    error: 'Error'
  }
  return map[status] || status
}

function resultsToCSV(items: CandidateResult[]): string {
  const headers = [
    'Rank', 'Name', 'Email', 'Phone', 'Current Title',
    'Experience Level', 'Years Exp', 'Applied For',
    'Evaluated At', 'Score', 'Skills Matched', 'Project Match',
    'Status', 'Stage', 'Email Sent',
  ]
  const rows = items.map((item, i) => [
    i + 1,
    `"${item.candidate_name}"`,
    item.candidate_email ?? '',
    item.candidate_phone ?? '',
    `"${item.candidate_current_title ?? ''}"`,
    item.candidate_experience_level ?? '',
    item.candidate_years_experience ?? '',
    `"${item.job_role_title}"`,
    item.evaluated_at,
    item.total_score,
    `${item.skills_matched}/${item.skills_total}`,
    item.project_match_label,
    getStatusLabel(getComputedStatus(item)),
    STAGE_LABEL_MAP[item.candidate_stage] ?? item.candidate_stage,
    item.email_sent_at ? 'Yes' : 'No',
  ])
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
}

export default function Leaderboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const selectedJobRoleId = useAppStore((s) => s.selectedJobRoleId)
  const userRole = useAppStore((s) => s.role)
  const showToast = useAppStore((s) => s.showToast)
  const isAdmin = userRole === 'admin'
  const confirm = useConfirm()

  const scoreMinParam = searchParams.get('scoreMin')
  const scoreMaxParam = searchParams.get('scoreMax')
  const scoreRangeFilter = scoreMinParam != null && scoreMaxParam != null
    ? { min: Number(scoreMinParam), max: Number(scoreMaxParam) }
    : null

  function clearScoreFilter() {
    setSearchParams((prev) => {
      prev.delete('scoreMin')
      prev.delete('scoreMax')
      return prev
    })
  }

  const SESSION_KEY = 'lb-filters'
  const _ss = (() => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}') } catch { return {} } })()

  const [sortKey, setSortKey] = useState<SortKey>(_ss.sortKey ?? 'total_score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(_ss.sortDir ?? 'desc')
  const [sandboxWeights, setSandboxWeights] = useState<SandboxWeights | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const [blindMode, setBlindMode] = useState(() => {
    try { return localStorage.getItem('lb-blind-mode') === 'true' } catch { return false }
  })

  const toggleBlindMode = () => {
    setBlindMode((v: boolean) => {
      const next = !v
      try { localStorage.setItem('lb-blind-mode', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  function maskName(name: string, index: number): string {
    return blindMode ? `Candidate #${index + 1}` : name
  }
  function maskEmail(email: string | null | undefined): string | null {
    if (!email) return null
    if (!blindMode) return email
    const [local] = email.split('@')
    return `${local.slice(0, 2)}***@***.***`
  }

  const [nameSearch, setNameSearch] = useState<string>(_ss.nameSearch ?? '')
  const [gradYearFrom, setGradYearFrom] = useState<number | ''>(_ss.gradYearFrom ?? '')
  const [gradYearTo, setGradYearTo] = useState<number | ''>(_ss.gradYearTo ?? '')
  const [expFrom, setExpFrom] = useState<number | ''>(_ss.expFrom ?? '')
  const [expTo, setExpTo] = useState<number | ''>(_ss.expTo ?? '')
  const [scoreFrom, setScoreFrom] = useState<number | ''>(_ss.scoreFrom ?? '')
  const [scoreTo, setScoreTo] = useState<number | ''>(_ss.scoreTo ?? '')
  const [filterStatus, setFilterStatus] = useState<string>(_ss.filterStatus ?? '')
  const [filterLevels, setFilterLevels] = useState<string[]>(_ss.filterLevels ?? [])
  const [filterLocations, setFilterLocations] = useState<string[]>(_ss.filterLocations ?? [])
  const [locationSearch, setLocationSearch] = useState<string>(_ss.locationSearch ?? '')

  function toggleFilterLevel(v: string) {
    setFilterLevels((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])
  }
  function toggleFilterLocation(v: string) {
    setFilterLocations((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])
  }

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      sortKey, sortDir, nameSearch, filterStatus, filterLevels, filterLocations, locationSearch,
      gradYearFrom, gradYearTo, expFrom, expTo, scoreFrom, scoreTo,
    }))
  }, [sortKey, sortDir, nameSearch, filterStatus, filterLevels, filterLocations, locationSearch, gradYearFrom, gradYearTo, expFrom, expTo, scoreFrom, scoreTo])

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showBulkEmailModal, setShowBulkEmailModal] = useState(false)
  const [panelItem, setPanelItem] = useState<CandidateResult | null>(null)
  const savedScrollRef = useRef<number>(0)
  const isInitialMount = useRef(true)
  const hasRestoredScroll = useRef(false)

  const openPanel = useCallback((item: CandidateResult) => {
    const mainEl = document.querySelector('main')
    if (mainEl) savedScrollRef.current = mainEl.scrollTop
    setPanelItem(item)
  }, [])

  const closePanel = useCallback(() => {
    const target = savedScrollRef.current
    setPanelItem(null)
    const restore = () => {
      const mainEl = document.querySelector('main')
      if (mainEl) mainEl.scrollTop = target
    }
    requestAnimationFrame(() => {
      restore()
      requestAnimationFrame(restore)
    })
    setTimeout(restore, 300)
  }, [])

  const PAGE_SIZE = 50

  // Reset scroll only when the user actively changes a filter — skip initial mount
  // so we don't wipe the saved position before the list has rendered.
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    const mainEl = document.querySelector('main')
    if (mainEl) mainEl.scrollTop = 0
    sessionStorage.removeItem('leaderboard-scroll-top')
    hasRestoredScroll.current = false
  }, [selectedJobRoleId, nameSearch, filterStatus, filterLevels, filterLocations, locationSearch, gradYearFrom, gradYearTo, expFrom, expTo, scoreFrom, scoreTo])

  // Switching job roles must drop any active What-If sandbox override — its
  // weights belong to the previous role and would otherwise keep silently
  // re-scoring/re-sorting the new role's results until the user notices.
  useEffect(() => {
    setSandboxWeights(null)
  }, [selectedJobRoleId])
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    isFetching,
  } = useInfiniteQuery({
    queryKey: ['results', selectedJobRoleId, nameSearch, filterStatus],
    queryFn: ({ pageParam = 1 }) =>
      getResults({
        job_role_id: selectedJobRoleId ?? undefined,
        sort: 'total_score',
        order: 'desc',
        limit: PAGE_SIZE,
        page: pageParam as number,
        search: nameSearch.trim() || undefined,
        status: filterStatus || undefined,
      }),
    getNextPageParam: (lastPage, allPages) => {
      const currentCount = allPages.reduce((sum, p) => sum + p.items.length, 0)
      if (currentCount >= lastPage.total) return undefined
      return allPages.length + 1
    },
    initialPageParam: 1,
    staleTime: 0,
    refetchInterval: panelItem ? false : 3000,
    // CRITICAL: must be false. When the panel closes, focus returns to the
    // window and React Query treats it as a window-focus event — it refetches
    // the infinite query from page 1 only, dropping all loaded pages (2, 3 …).
    // Candidates #51+ disappear and the user is effectively sent to the top.
    // The refetchInterval already keeps data fresh; window-focus refetch is redundant.
    refetchOnWindowFocus: false,
  })

  // Persist scroll position on every scroll so it survives route navigation.
  // Also triggers infinite-scroll page loading near the bottom.
  useEffect(() => {
    const mainEl = document.querySelector('main')
    if (!mainEl) return

    const handleScroll = () => {
      sessionStorage.setItem('leaderboard-scroll-top', String(mainEl.scrollTop))
      const threshold = 200
      const isNearBottom = mainEl.scrollHeight - mainEl.scrollTop - mainEl.clientHeight < threshold
      if (isNearBottom && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    }

    mainEl.addEventListener('scroll', handleScroll)
    return () => mainEl.removeEventListener('scroll', handleScroll)
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Restore scroll position once the cached items are painted in the DOM.
  // This fires after route-back navigation when data is served from cache.
  const rawItemCount = data?.pages.reduce((n, p) => n + p.items.length, 0) ?? 0
  useEffect(() => {
    if (isLoading || rawItemCount === 0 || hasRestoredScroll.current) return
    const saved = sessionStorage.getItem('leaderboard-scroll-top')
    if (saved) {
      hasRestoredScroll.current = true
      const mainEl = document.querySelector('main')
      if (mainEl) {
        setTimeout(() => {
          mainEl.scrollTop = Number(saved)
        }, 50)
      }
    } else {
      hasRestoredScroll.current = true
    }
  }, [rawItemCount, isLoading])

  const { data: summary, isFetching: summaryFetching } = useQuery({
    queryKey: ['results-summary', selectedJobRoleId],
    queryFn: () => getResultsSummary(selectedJobRoleId ?? undefined),
    staleTime: 0,
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
  })

  const { data: evalStatus } = useQuery({
    queryKey: ['eval-status', selectedJobRoleId],
    queryFn: () => getEvaluationStatus(selectedJobRoleId!),
    enabled: !!selectedJobRoleId,
    staleTime: 0,
    refetchInterval: 3000,
  })

  const { data: jobRoles } = useQuery({
    queryKey: ['job-roles'],
    queryFn: getJobRoles,
  })
  const selectedRole = jobRoles?.find((r: JobRole) => r.id === selectedJobRoleId) ?? null

  const intakeMut = useMutation({
    mutationFn: (paused: boolean) => setIntakePause(selectedRole!.id, paused),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['job-roles'] }),
  })

  const autoShortlistMut = useMutation({
    mutationFn: () => autoApplyShortlist(selectedJobRoleId!),
    onSuccess: (res: { applied: number; total_qualifying: number }) => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      showToast(`Auto-shortlist applied: ${res.applied} new shortlisted (${res.total_qualifying} qualifying total).`, 'success')
    },
    onError: () => showToast('Auto-shortlist failed. Make sure a min fit score is configured.', 'error'),
  })

  const bulkShortlistMut = useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: ShortlistStatus }) =>
      bulkShortlist(ids, status),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setSelectedIds(new Set())
      if (res.missing.length > 0) showToast(`${res.updated} updated. ${res.missing.length} not found.`, 'success')
    },
  })

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: number[]) => bulkDelete(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
      setSelectedIds(new Set())
    },
  })

  const stageMut = useMutation({
    mutationFn: ({ evaluationId, stage }: { candidateId: number; evaluationId: number; stage: CandidateStage }) =>
      updateEvaluationStage(evaluationId, stage),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['results'] }),
  })

  const bulkStageMut = useMutation({
    mutationFn: ({ ids, stage }: { ids: number[]; stage: CandidateStage }) => bulkUpdateStage(ids, stage),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setSelectedIds(new Set())
      showToast(`${res.updated} candidate(s) moved to ${STAGE_LABEL_MAP[res.stage] ?? res.stage}.`, 'success')
    },
    onError: () => showToast('Bulk stage move failed.', 'error'),
  })

  const [bulkEmailMsg, setBulkEmailMsg] = useState<string | null>(null)
  const bulkEmailMut = useMutation({
    mutationFn: () => bulkSendNextSteps(selectedJobRoleId!),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setBulkEmailMsg(res.message)
      setTimeout(() => setBulkEmailMsg(null), 5000)
    },
    onError: () => {
      setBulkEmailMsg('Bulk email failed')
      setTimeout(() => setBulkEmailMsg(null), 4000)
    },
  })

  const [reclassifyMsg, setReclassifyMsg] = useState<string | null>(null)
  const reclassifyMut = useMutation({
    mutationFn: reclassifyExperienceLevels,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setReclassifyMsg(`Reclassified ${res.updated} of ${res.total} candidates`)
      setTimeout(() => setReclassifyMsg(null), 5000)
    },
    onError: () => { setReclassifyMsg('Reclassification failed'); setTimeout(() => setReclassifyMsg(null), 4000) },
  })

  const pauseMut = useMutation({
    mutationFn: () => pauseEvaluation(selectedJobRoleId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-status', selectedJobRoleId] })
    },
  })

  const resumeMut = useMutation({
    mutationFn: () => resumeEvaluation(selectedJobRoleId!),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['eval-status', selectedJobRoleId] })
      queryClient.invalidateQueries({ queryKey: ['results-summary', selectedJobRoleId] })
      if (res.queued_count === 0) showToast('No queued evaluations to resume.', 'success')
    },
  })

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const [selectAllLoading, setSelectAllLoading] = useState(false)

  async function toggleSelectAll() {
    if (selectedIds.size > 0) {
      setSelectedIds(new Set())
      return
    }
    setSelectAllLoading(true)
    try {
      const all = await fetchAllResults()
      setSelectedIds(new Set(all.map((r) => r.evaluation_id)))
    } finally {
      setSelectAllLoading(false)
    }
  }

  const deleteMutation = useMutation({
    mutationFn: deleteResult,
    onMutate: async (evaluationId: number) => {
      await queryClient.cancelQueries({ queryKey: ['results'] })
      const prev = queryClient.getQueriesData({ queryKey: ['results'] })
      queryClient.setQueriesData({ queryKey: ['results'] }, (old: any) => {
        if (!old?.items) return old
        return { ...old, items: old.items.filter((i: any) => i.evaluation_id !== evaluationId), total: Math.max(0, (old.total ?? old.items.length) - 1) }
      })
      return { prev }
    },
    onError: (_err, _id, context: any) => {
      if (context?.prev) {
        context.prev.forEach(([key, val]: any) => queryClient.setQueryData(key, val))
      }
      showToast('Failed to delete result.', 'error')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
    },
  })

  const deleteAllMutation = useMutation({
    mutationFn: deleteAllResults,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['results'] })
      queryClient.setQueriesData({ queryKey: ['results'] }, (old: any) =>
        old ? { ...old, items: [], total: 0 } : old
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
      queryClient.invalidateQueries({ queryKey: ['candidate-search'] })
      queryClient.invalidateQueries({ queryKey: ['inboundEmails'] })
    },
    onError: () => {
      showToast('Failed to clear results.', 'error')
      queryClient.invalidateQueries({ queryKey: ['results'] })
    },
  })

  const rawItems = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? []
  }, [data?.pages])
  const baseItems = useMemo(() => {
    let arr = rawItems
    if (scoreRangeFilter) {
      arr = arr.filter((r) => r.total_score >= scoreRangeFilter.min && r.total_score < scoreRangeFilter.max + 10)
    }
    if (scoreFrom !== '') {
      arr = arr.filter((r) => r.total_score >= Number(scoreFrom))
    }
    if (scoreTo !== '') {
      arr = arr.filter((r) => r.total_score <= Number(scoreTo))
    }
    if (gradYearFrom !== '') {
      arr = arr.filter((r) => r.candidate_graduation_year != null && r.candidate_graduation_year >= Number(gradYearFrom))
    }
    if (gradYearTo !== '') {
      arr = arr.filter((r) => r.candidate_graduation_year != null && r.candidate_graduation_year <= Number(gradYearTo))
    }
    if (expFrom !== '') {
      arr = arr.filter((r) => r.candidate_years_experience != null && r.candidate_years_experience >= Number(expFrom))
    }
    if (expTo !== '') {
      arr = arr.filter((r) => r.candidate_years_experience != null && r.candidate_years_experience <= Number(expTo))
    }
    if (filterStatus) {
      if (filterStatus === 'review') {
        // Match: backend returns 'review', OR candidate has needs_manual_review with any unevaluated status
        arr = arr.filter((r) =>
          r.status === 'review' ||
          (r.needs_manual_review && (r.status === 'done' || r.status === 'pending' || !r.status)) ||
          (r.status === 'pending' && r.filter_stage === 'llm_scored')
        )
      } else if (filterStatus === 'rejected') {
        arr = arr.filter((r) =>
          r.status === 'rejected' ||
          r.filter_stage === 'experience_filtered' ||
          r.filter_stage === 'tfidf_filtered'
        )
      } else {
        arr = arr.filter((r) => r.status === filterStatus)
      }
    }
    if (filterLevels.length > 0) {
      arr = arr.filter((r) => filterLevels.includes(r.candidate_experience_level ?? 'entry'))
    }
    if (filterLocations.length > 0) {
      arr = arr.filter((r) => {
        const loc = (r.candidate_location ?? '').toLowerCase()
        return filterLocations.some((fl) => loc.includes(fl.toLowerCase()))
      })
    }
    if (locationSearch.trim()) {
      const loc = locationSearch.trim().toLowerCase()
      arr = arr.filter((r) => (r.candidate_location ?? '').toLowerCase().includes(loc))
    }
    return arr
  }, [rawItems, scoreRangeFilter, scoreFrom, scoreTo, gradYearFrom, gradYearTo, expFrom, expTo, filterStatus, filterLevels, filterLocations, locationSearch])

  function sandboxScore(item: CandidateResult): number {
    if (!sandboxWeights) return item.total_score
    return (
      (item.project_score * sandboxWeights.projects +
        item.skill_score * sandboxWeights.skills +
        item.education_score * sandboxWeights.education) /
      100
    )
  }

  const items = useMemo(() => {
    const arr = [...baseItems]
    arr.sort((a, b) => {
      let av: string | number, bv: string | number
      switch (sortKey) {
        case 'candidate_name':
          av = displayName(a.candidate_name, a.candidate_email).toLowerCase()
          bv = displayName(b.candidate_name, b.candidate_email).toLowerCase()
          break
        case 'skills_matched':
          av = a.skills_matched; bv = b.skills_matched; break
        case 'years_experience':
          av = a.candidate_years_experience ?? 0; bv = b.candidate_years_experience ?? 0; break
        case 'current_title':
          av = (a.candidate_current_title ?? '').toLowerCase()
          bv = (b.candidate_current_title ?? '').toLowerCase()
          break
        case 'job_role_title':
          av = (a.job_role_title ?? '').toLowerCase()
          bv = (b.job_role_title ?? '').toLowerCase()
          break
        case 'candidate_location':
          av = (a.candidate_location ?? '').toLowerCase()
          bv = (b.candidate_location ?? '').toLowerCase()
          break
        default:
          av = sandboxWeights ? sandboxScore(a) : a.total_score
          bv = sandboxWeights ? sandboxScore(b) : b.total_score
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return arr
  }, [baseItems, sortKey, sortDir, sandboxWeights])

  const totalEvaluated = summary?.total ?? data?.pages[0]?.total ?? items.length
  const avgScore = summary ? Math.round(summary.avg_score) : null
  const shortlisted = summary?.shortlisted ?? 0
  const needsReview = summary?.needs_review ?? 0
  const pendingCount = summary?.pending ?? 0
  const tfidfFiltered = summary?.tfidf_filtered ?? 0
  const experienceFiltered = summary?.experience_filtered ?? 0
  const autoRejected = tfidfFiltered + experienceFiltered
  const queuedCount = summary?.queued ?? 0

  function exportCSV() {
    const csv = resultsToCSV(items)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'leaderboard.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportSelected(format: 'csv' | 'json') {
    const selected = items.filter((it) => selectedIds.has(it.evaluation_id))
    const content = format === 'csv' ? resultsToCSV(selected) : JSON.stringify(selected, null, 2)
    const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `selected-candidates.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function fetchAllResults(): Promise<CandidateResult[]> {
    const all: CandidateResult[] = []
    let page = 1
    const limit = 200
    while (true) {
      const res = await getResults({
        job_role_id: selectedJobRoleId ?? undefined,
        sort: 'total_score',
        order: 'desc',
        limit,
        page,
        search: nameSearch.trim() || undefined,
        status: filterStatus || undefined,
      })
      all.push(...res.items)
      if (all.length >= res.total) break
      page++
    }
    return all
  }

  function buildHtmlReport(allItems: CandidateResult[]): string {
    const STAGE_LABELS_MAP: Record<string, string> = {
      applied: 'Applied', screening: 'Screening', coding: 'Coding',
      interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected',
    }
    const STATUS_COLOR: Record<string, string> = {
      shortlisted: '#1D9E75', rejected: '#E24B4A', review: '#EF9F27', pending: '#888',
    }

    const rows = allItems.map((it, i) => {
      const score = Math.round(it.total_score ?? 0)
      const scoreColor = score >= 75 ? '#1D9E75' : score >= 50 ? '#EF9F27' : '#E24B4A'
      // Skills as plain comma-separated text — max 6, then "+N more"
      const skills = it.matched_skill_names ?? []
      const skillText = skills.length === 0
        ? `${it.skills_matched ?? 0}/${it.skills_total ?? 0} matched`
        : skills.slice(0, 6).join(', ') + (skills.length > 6 ? ` +${skills.length - 6}` : '')
      
      const computedStatus = getComputedStatus(it)
      const statusLabel = getStatusLabel(computedStatus)
      const statusColor = STATUS_COLOR[computedStatus] ?? '#888'
      
      const evalDate = it.evaluated_at ? new Date(it.evaluated_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' }) : '—'
      const rowBg = i % 2 === 0 ? '' : 'background:#f7f7ff'
      return `<tr style="border-bottom:1px solid #e5e5e5;${rowBg}">
        <td class="c">${i + 1}</td>
        <td class="bold">${it.candidate_name ?? ''}</td>
        <td class="sm">${it.candidate_email ?? ''}</td>
        <td class="sm mono">${it.candidate_phone ?? '—'}</td>
        <td class="sm">${it.candidate_location ?? '—'}</td>
        <td class="c bold" style="color:${scoreColor}">${score}</td>
        <td class="sk">${skillText}</td>
        <td class="sm">${(it.job_role_title ?? '—').replace('Engineering','Eng.').replace('Product','Prod.')}</td>
        <td class="c sm">${it.candidate_experience_level ?? '—'}</td>
        <td class="c sm">${it.candidate_years_experience != null ? `${it.candidate_years_experience.toFixed(1)}y` : '—'}</td>
        <td class="c sm">${STAGE_LABELS_MAP[it.candidate_stage ?? ''] ?? (it.candidate_stage ?? '—')}</td>
        <td class="c sm bold" style="color:${statusColor}">${statusLabel}</td>
        <td class="c sm">${evalDate}</td>
      </tr>`
    }).join('')

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Candidate Evaluation Report</title>
<style>
  @page { size: A4 landscape; margin: 8mm 6mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial,Helvetica,sans-serif; font-size:8.5px; color:#111; margin:0; padding:0; }
  .header { padding:6px 0 4px; border-bottom:2px solid #534AB7; margin-bottom:6px; display:flex; justify-content:space-between; align-items:flex-end; }
  .header h1 { font-size:13px; color:#534AB7; margin:0; }
  .header .meta { font-size:8px; color:#888; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  col.c1 { width:22px }   /* # */
  col.c2 { width:90px }   /* Name */
  col.c3 { width:120px }  /* Email */
  col.c4 { width:72px }   /* Phone */
  col.c5 { width:60px }   /* Location */
  col.c6 { width:28px }   /* Score */
  col.c7 { width:170px }  /* Skills */
  col.c8 { width:74px }   /* Role */
  col.c9 { width:36px }   /* Level */
  col.c10 { width:22px }  /* Exp */
  col.c11 { width:42px }  /* Stage */
  col.c12 { width:52px }  /* Status */
  col.c13 { width:38px }  /* Date */
  thead tr { background:#534AB7; color:#fff; }
  th { padding:4px 4px; text-align:left; font-size:8px; font-weight:700; white-space:nowrap; overflow:hidden; }
  td { padding:3px 4px; vertical-align:middle; overflow:hidden; }
  td.sk { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:7.5px; color:#3C3489; }
  td.c { text-align:center; }
  td.sm { font-size:7.5px; color:#444; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  td.bold { font-weight:600; }
  td.mono { font-family:monospace; }
  tr:hover { background:#f0f0ff; }
  .print-btn { margin-bottom:8px; padding:5px 14px; background:#534AB7; color:#fff; border:none; border-radius:5px; cursor:pointer; font-size:11px; }
  @media print {
    .print-btn { display:none !important; }
    body { font-size:8px; }
    tr { page-break-inside:avoid; }
    thead { display:table-header-group; }
  }
</style></head><body>
<div class="header">
  <div>
    <h1>Candidate Evaluation Report</h1>
    <div class="meta">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; <strong>${allItems.length}</strong> candidates</div>
  </div>
  <button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
</div>
<table>
<colgroup>
  <col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5">
  <col class="c6"><col class="c7"><col class="c8"><col class="c9"><col class="c10">
  <col class="c11"><col class="c12"><col class="c13">
</colgroup>
<thead><tr>
  <th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Location</th>
  <th>Score</th><th>Matched Skills</th><th>Role</th><th>Level</th><th>Exp</th>
  <th>Stage</th><th>Status</th><th>Evaluated</th>
</tr></thead>
<tbody>${rows}</tbody>
</table></body></html>`
  }

  async function handleExportAllHtml(): Promise<void> {
    const allItems = await fetchAllResults()
    const html = buildHtmlReport(allItems)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report_${new Date().toISOString().slice(0, 10)}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handlePrintAll(): Promise<void> {
    const allItems = await fetchAllResults()
    const html = buildHtmlReport(allItems)
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 500)
  }

  async function handleExportToSharePoint(format: 'pdf' | 'csv' | 'xlsx'): Promise<void> {
    try {
      const res = await exportResultsToSharePoint({
        job_role_id: selectedJobRoleId ?? undefined,
        status: filterStatus || undefined,
        search: nameSearch || undefined,
        format,
      })
      showToast(`Saved "${res.filename}" to SharePoint.`, 'success')
    } catch (err: any) {
      showToast(err?.response?.data?.detail ?? 'Failed to save results to SharePoint.', 'error')
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-5 w-full min-w-0 max-w-full border-t-4 border-accent">
      {/* Auto-pause intake banner */}
      {selectedRole?.intake_paused && (
        <div className="no-print flex items-center justify-between bg-warning-100 border border-warning rounded-xl px-5 py-3">
          <div>
            <p className="text-sm font-semibold text-warning-800">Intake paused — shortlist target reached</p>
            <p className="text-xs text-warning-800/70 mt-0.5">
              New applications are queued. Review your shortlist and resume intake when ready.
            </p>
          </div>
          <button
            onClick={() => intakeMut.mutate(false)}
            disabled={intakeMut.isPending}
            className="ml-4 shrink-0 bg-warning hover:bg-[#c98112] disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-1.5 transition-colors"
          >
            {intakeMut.isPending ? 'Resuming…' : 'Resume intake'}
          </button>
        </div>
      )}

      {/* Summary KPI Cards — hidden during PDF print */}
      <div className="no-print">
        <SummaryCards
          totalEvaluated={totalEvaluated}
          avgScore={avgScore}
          shortlisted={shortlisted}
          needsReview={needsReview}
          pendingCount={pendingCount}
          autoRejected={autoRejected}
          tfidfFiltered={tfidfFiltered}
          experienceFiltered={experienceFiltered}
          queuedCount={queuedCount}
          summaryFetching={summaryFetching}
          summary={summary}
          scoreRangeFilter={scoreRangeFilter}
          clearScoreFilter={clearScoreFilter}
        />
      </div>

      {/* Bulk Action Bar — hidden during PDF print */}
      {selectedIds.size > 0 && (
        <div className="no-print flex items-center gap-3 bg-accent-100 dark:bg-accent-900 border border-accent-300 rounded-xl px-4 py-2.5">
          <span className="text-sm font-semibold text-accent-700 dark:text-accent-300">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-2 ml-2">
            <button
              onClick={() => bulkShortlistMut.mutate({ ids: [...selectedIds], status: 'shortlisted' })}
              disabled={bulkShortlistMut.isPending}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-success-100 text-success-800 border border-success-300 hover:bg-success-200 disabled:opacity-50 transition-colors"
            >
              Shortlist
            </button>
            <button
              onClick={() => bulkShortlistMut.mutate({ ids: [...selectedIds], status: 'review' })}
              disabled={bulkShortlistMut.isPending}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-warning-100 text-warning-800 border border-warning hover:bg-warning-200 disabled:opacity-50 transition-colors"
            >
              Needs Review
            </button>
            <button
              onClick={() => bulkShortlistMut.mutate({ ids: [...selectedIds], status: 'rejected' })}
              disabled={bulkShortlistMut.isPending}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-danger-100 text-danger-800 border border-danger hover:bg-danger-200 disabled:opacity-50 transition-colors"
            >
              Reject
            </button>
            <button
              onClick={async () => {
                if (await confirm({
                  title: 'Delete Selected Results?',
                  description: `Delete ${selectedIds.size} selected results? This cannot be undone.`,
                  intent: 'danger'
                })) {
                  bulkDeleteMut.mutate([...selectedIds])
                }
              }}
              disabled={bulkDeleteMut.isPending}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              Delete
            </button>
            {selectedIds.size === 2 && (
              <button
                onClick={() => {
                  const [a, b] = [...selectedIds]
                  navigate(`/compare?a=${a}&b=${b}`)
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 text-accent border border-accent/40 hover:bg-accent-100 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Compare (2)
              </button>
            )}
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) bulkStageMut.mutate({ ids: [...selectedIds], stage: e.target.value as CandidateStage })
              }}
              disabled={bulkStageMut.isPending}
              className="text-xs font-semibold px-2 py-1.5 rounded-lg bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:border-accent disabled:opacity-50 transition-colors"
            >
              <option value="">Move to stage…</option>
              {Object.entries(STAGE_LABEL_MAP).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <button
              onClick={() => setShowBulkEmailModal(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 text-accent border border-accent/40 hover:bg-accent-100 transition-colors"
            >
              Email Selected
            </button>
            <button
              onClick={() => exportSelected('csv')}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:border-accent transition-colors"
            >
              Export CSV
            </button>
            <button
              onClick={() => exportSelected('json')}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:border-accent transition-colors"
            >
              Export JSON
            </button>
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-accent dark:text-accent-300 hover:underline"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Share button */}
      {selectedRole && (
        <div className="no-print flex justify-end">
          <button
            onClick={() => setShowShareModal(true)}
            className="flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-xl border border-accent/40 text-accent bg-accent-100/50 hover:bg-accent-100 dark:bg-accent-900/40 dark:hover:bg-accent-900 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Share{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </button>
        </div>
      )}

      {/* What-If Scoring Weights Sandbox */}
      <div className="no-print">
        <WeightsSandbox
          key={selectedJobRoleId}
          defaultWeights={{
            projects: selectedRole?.weight_projects ?? 45,
            skills: selectedRole?.weight_skills ?? 35,
            education: selectedRole?.weight_education ?? 20,
          }}
          onChange={setSandboxWeights}
        />
      </div>

      {/* Filter and Action Controls — hidden during PDF print */}
      <div className="no-print sticky top-0 z-30 bg-canvas dark:bg-gray-950 pt-2 pb-2 -mx-4 px-4 md:-mx-6 md:px-6 shadow-sm border-b border-gray-200 dark:border-gray-800">
      <FilterControls
        nameSearch={nameSearch}
        setNameSearch={setNameSearch}
        gradYearFrom={gradYearFrom}
        setGradYearFrom={setGradYearFrom}
        gradYearTo={gradYearTo}
        setGradYearTo={setGradYearTo}
        expFrom={expFrom}
        setExpFrom={setExpFrom}
        expTo={expTo}
        setExpTo={setExpTo}
        scoreFrom={scoreFrom}
        setScoreFrom={setScoreFrom}
        scoreTo={scoreTo}
        setScoreTo={setScoreTo}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        filterLevels={filterLevels}
        toggleFilterLevel={toggleFilterLevel}
        filterLocations={filterLocations}
        toggleFilterLocation={toggleFilterLocation}
        availableLocations={[...new Set(items.map((r) => r.candidate_location).filter(Boolean) as string[])].sort()}
        locationSearch={locationSearch}
        setLocationSearch={setLocationSearch}
        sortKey={sortKey}
        setSortKey={setSortKey}
        selectedJobRoleId={selectedJobRoleId}
        evalStatus={evalStatus}
        queuedCount={queuedCount}
        isAdmin={isAdmin}
        bulkEmailMut={bulkEmailMut}
        bulkEmailMsg={bulkEmailMsg}
        deleteAllMutation={deleteAllMutation}
        pauseMut={pauseMut}
        resumeMut={resumeMut}
        blindMode={blindMode}
        onToggleBlindMode={toggleBlindMode}
        autoShortlistMut={autoShortlistMut}
        reclassifyMut={reclassifyMut}
        reclassifyMsg={reclassifyMsg}
        exportCSV={exportCSV}
        downloadResultsCsv={downloadResultsCsv}
        onExportAllHtml={handleExportAllHtml}
        onPrintAll={handlePrintAll}
        onExportToSharePoint={handleExportToSharePoint}
        isFetching={isFetching && !isLoading}
        refreshResults={() => {
          queryClient.resetQueries({ queryKey: ['results', selectedJobRoleId] })
          queryClient.invalidateQueries({ queryKey: ['results-summary', selectedJobRoleId] })
        }}
        items={items}
      />
      </div>

      {/* Candidate Grid Table or Needs Review Buckets */}
      {filterStatus === 'review' ? (
        <NeedsReviewBuckets
          items={items}
          selectedRole={selectedRole}
          bulkShortlistMut={bulkShortlistMut}
          selectedIds={selectedIds}
          toggleSelect={toggleSelect}
          onOpenPreview={(resumeId, _name) => {
            fetchResumeFileBlob(resumeId).then((blob) => {
              const url = URL.createObjectURL(blob)
              window.open(url, '_blank')
            })
          }}
          onManualEval={openPanel}
          deleteMutation={deleteMutation}
          blindMode={blindMode}
        />
      ) : (
        <CandidateTable
          items={items}
          isLoading={isLoading}
          isError={isError}
          selectedIds={selectedIds}
          toggleSelectAll={toggleSelectAll}
          selectAllLoading={selectAllLoading}
          totalEvaluated={totalEvaluated}
          toggleSelect={toggleSelect}
          blindMode={blindMode}
          maskName={maskName}
          maskEmail={maskEmail}
          isAdmin={isAdmin}
          stageMut={stageMut}
          deleteMutation={deleteMutation}
          groupByExp={false}
          page={1}
          PAGE_SIZE={PAGE_SIZE}
          sortKey={sortKey}
          sortDir={sortDir}
          toggleSort={toggleSort}
          selectedRole={selectedRole}
          onOpenPreview={(resumeId, _name) => {
            fetchResumeFileBlob(resumeId).then((blob) => {
              const url = URL.createObjectURL(blob)
              window.open(url, '_blank')
            })
          }}
          onManualEval={openPanel}
          onRowClick={(item) => navigate(`/results/${item.evaluation_id}`)}
          onRefresh={() => queryClient.invalidateQueries({ queryKey: ['results'] })}
          sandboxScoreFn={sandboxWeights ? sandboxScore : undefined}
        />
      )}

      {/* Share Links Modal */}
      {showShareModal && (
        <ShareLinksModal
          selectedRole={selectedRole}
          selectedIds={selectedIds}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* Bulk Email Composer Modal */}
      {showBulkEmailModal && (
        <BulkEmailComposerModal
          recipients={items
            .filter((it) => selectedIds.has(it.evaluation_id))
            .map((it) => ({
              evaluationId: it.evaluation_id,
              candidateName: it.candidate_name,
              jobTitle: it.job_role_title,
              score: it.total_score,
              yearsExperience: it.candidate_years_experience ?? null,
            }))}
          onClose={() => setShowBulkEmailModal(false)}
          onSent={({ sent, failed }) => showToast(`Sent ${sent} email(s)${failed > 0 ? `, ${failed} failed` : ''}.`, failed > 0 ? 'error' : 'success')}
        />
      )}

      {/* Manual Evaluation Panel — hidden during PDF print */}
      <div className="no-print">
        <ManualEvalPanel
          item={panelItem}
          roleSkillNames={selectedRole?.skill_names ?? []}
          onClose={closePanel}
        />
      </div>


      {/* Pagination Status / Infinite Scroll Indicator — hidden during PDF print */}
      <div className="no-print flex flex-col items-center justify-center py-4 px-1">
        {isFetchingNextPage ? (
          <div className="flex items-center gap-2 text-sm text-accent dark:text-accent-300 font-semibold animate-pulse">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading more candidates...
          </div>
        ) : !hasNextPage && items.length > 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">
            Showing all {totalEvaluated} evaluated candidates
          </p>
        ) : items.length > 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Scroll down to load more candidates (Showing {items.length} of {totalEvaluated})
          </p>
        ) : null}
      </div>
    </div>
  )
}
