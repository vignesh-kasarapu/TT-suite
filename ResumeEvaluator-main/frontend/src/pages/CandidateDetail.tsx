import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getResultDetail,
  shortlistCandidate,
  reclassifyAndRescore,
  reparseCandidate,
  scheduleInterview,
  updateCandidate,
} from '../api/client'
import type {
  ShortlistStatus,
  SkillMatch,
  EvaluationDetail,
  RequirementBreakdown,
  ResumeSection,
} from '../api/client'
import ScoreBar from '../components/ScoreBar'
import StatusBadge from '../components/StatusBadge'
import EmailComposerModal from '../components/Leaderboard/EmailComposerModal'
import EnrichmentTab from '../components/CandidateDetail/EnrichmentTab'
import FeedbackTab from '../components/CandidateDetail/FeedbackTab'
import CommentsTab from '../components/CandidateDetail/CommentsTab'
import PdfSplitView from '../components/CandidateDetail/PdfSplitView'
import { useAppStore } from '../store/useAppStore'

type Tab = 'breakdown' | 'enrichment' | 'collaboration'

const SKILL_CHIP_STYLES: Record<string, string> = {
  projects: 'bg-success-100 text-success border-success-300/40',
  experience: 'bg-success-100 text-success border-success-300/40',
  work_experience: 'bg-success-100 text-success border-success-300/40',
  skills_section: 'bg-accent-100 text-accent border-accent-300/40',
  skills: 'bg-accent-100 text-accent border-accent-300/40',
  certifications: 'bg-accent-100 text-accent border-accent-300/40',
  education: 'bg-[#E1F5FE] text-[#004D7A] border-[#74C2F1]/40',
  unknown: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600',
}

const SKILL_CHIP_LABELS: Record<string, string> = {
  projects: 'Projects / Experience',
  skills_section: 'Skills Section',
  education: 'Education',
  unknown: 'Other',
}

function ScoreCircle({ score }: { score: number }) {
  const color = score >= 75 ? '#1D9E75' : score >= 50 ? '#EF9F27' : '#E24B4A'
  const circumference = 2 * Math.PI * 36
  const dash = (score / 100) * circumference

  return (
    <div className="relative w-28 h-28 flex items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="36" fill="none" stroke="#e5e7eb" strokeWidth="5" />
        <circle
          cx="40" cy="40" r="36" fill="none"
          stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="flex flex-col items-center">
        <span className="text-3xl font-black tracking-tight" style={{ color }}>{Math.round(score)}</span>
        <span className="text-[10px] uppercase font-bold text-gray-400 -mt-1">Score</span>
      </div>
    </div>
  )
}

interface CandidateDetailProps {
  inlineId?: number
  onClose?: () => void
}

export default function CandidateDetail({ inlineId, onClose }: CandidateDetailProps = {}) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const evaluationId = inlineId ?? Number(id)
  const isInline = inlineId !== undefined
  const showToast = useAppStore((s) => s.showToast)

  const [searchParams, setSearchParams] = useSearchParams()
  const [inlineTab, setInlineTab] = useState<Tab>('breakdown')
  const activeTab = isInline ? inlineTab : ((searchParams.get('tab') as Tab | null) ?? 'breakdown')
  const [noteText, setNoteText] = useState('')
  const [noteStatus, setNoteStatus] = useState<ShortlistStatus>('review')
  const [noteSaved, setNoteSaved] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [showPdfViewer, setShowPdfViewer] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleLink, setScheduleLink] = useState('')
  const [scheduleSaved, setScheduleSaved] = useState(false)
  const [localSections, setLocalSections] = useState<ResumeSection[]>([])
  const [sectionsSaved, setSectionsSaved] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set())
  const [newTag, setNewTag] = useState('')

  const { data: rawData, isLoading, isError } = useQuery({
    queryKey: ['resultDetail', evaluationId],
    queryFn: () => getResultDetail(evaluationId),
    enabled: !!evaluationId,
  })

  const data = rawData as EvaluationDetail | undefined

  useEffect(() => {
    if (!data) return
    if (data.notes) setNoteText(data.notes)
    if (data.shortlist_status) setNoteStatus(data.shortlist_status)
    if (data.interview_scheduled_at) {
      setScheduleDate(data.interview_scheduled_at.slice(0, 16))
    }
    if (data.interview_link) setScheduleLink(data.interview_link)
  }, [data])

  const shortlistMut = useMutation({
    mutationFn: () => shortlistCandidate(evaluationId, noteStatus, noteText),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resultDetail', evaluationId] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setNoteSaved(true)
      setTimeout(() => setNoteSaved(false), 2000)
    },
  })



  const scheduleMut = useMutation({
    mutationFn: () => scheduleInterview(
      evaluationId,
      scheduleDate || null,
      scheduleLink || null,
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resultDetail', evaluationId] })
      setScheduleSaved(true)
      setShowSchedule(false)
      setTimeout(() => setScheduleSaved(false), 3000)
    },
  })

  const tagsMut = useMutation({
    mutationFn: (tags: string[]) => updateCandidate(data!.candidate_id, { tags }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resultDetail', evaluationId] })
    },
    onError: () => showToast('Failed to update tags.', 'error'),
  })

  function addTag() {
    const tag = newTag.trim()
    if (!tag || !data) return
    if (data.tags?.includes(tag)) { setNewTag(''); return }
    tagsMut.mutate([...(data.tags ?? []), tag])
    setNewTag('')
  }

  function removeTag(tag: string) {
    if (!data) return
    tagsMut.mutate((data.tags ?? []).filter((t) => t !== tag))
  }

  const [reparseDone, setReparseDone] = useState(false)
  const reparseMut = useMutation({
    mutationFn: () => reparseCandidate(data!.candidate_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resultDetail', evaluationId] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setReparseDone(true)
      setTimeout(() => setReparseDone(false), 3000)
    },
    onError: () => showToast('Re-parse failed. The stored resume text may be missing.', 'error'),
  })

  useEffect(() => {
    if (data?.resume_sections && localSections.length === 0) {
      setLocalSections(data.resume_sections as ResumeSection[])
    }
  }, [data?.resume_sections])

  const reclassifyMut = useMutation({
    mutationFn: () => reclassifyAndRescore(evaluationId),
    onSuccess: () => {
      setSectionsSaved(true)
      setTimeout(() => {
        setSectionsSaved(false)
        setLocalSections([])
        queryClient.invalidateQueries({ queryKey: ['resultDetail', evaluationId] })
      }, 2000)
    },
  })

  function toggleSection(index: number) {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'breakdown', label: 'Score Breakdown' },
    { key: 'enrichment', label: 'Enrichment' },
    { key: 'collaboration', label: 'Notes & Feedback' },
  ]

  if (isLoading) {
    return (
      <div className={`flex flex-col ${isInline ? 'h-full' : 'h-[calc(100vh-56px)]'} animate-pulse`}>
        {/* Header skeleton */}
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0" />
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-40" />
              <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-52" />
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <div className="h-9 w-28 bg-gray-100 dark:bg-gray-700 rounded-lg" />
            <div className="h-9 w-28 bg-gray-100 dark:bg-gray-700 rounded-lg" />
          </div>
        </div>
        {/* Tab bar skeleton */}
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 flex gap-6 shrink-0 py-1">
          {[72, 64, 80, 56, 68, 76].map((w, i) => (
            <div key={i} className="h-3 bg-gray-100 dark:bg-gray-700 rounded my-2.5" style={{ width: w }} />
          ))}
        </div>
        {/* Body skeleton */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-32" />
              <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded w-full" />
              <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded w-3/4" />
              <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded w-5/6" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className={`flex flex-col items-center justify-center ${isInline ? 'h-64' : 'h-[calc(100vh-56px)]'} gap-3`}>
        <p className="text-danger-800">Failed to load candidate detail.</p>
        <button onClick={() => isInline ? onClose?.() : navigate(-1)} className="text-sm text-accent underline">Go back</button>
      </div>
    )
  }

  const foundInProjects = data.skills_matched?.filter((s) => ['projects', 'experience', 'work_experience'].includes(s.best_section)) || []
  const foundInSkills = data.skills_matched?.filter((s) => ['skills_section', 'skills', 'certifications'].includes(s.best_section)) || []
  const foundInEducation = data.skills_matched?.filter((s) => s.best_section === 'education') || []
  const foundOther = data.skills_matched?.filter((s) => !['projects', 'experience', 'work_experience', 'skills_section', 'skills', 'certifications', 'education'].includes(s.best_section)) || []
  const missing = data.skill_gaps || []

  function SkillChip({ match }: { match: SkillMatch }) {
    return (
      <span
        className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border ${SKILL_CHIP_STYLES[match.best_section] ?? SKILL_CHIP_STYLES.unknown}`}
        title={`Score: ${(match.score * 100).toFixed(0)}%`}
      >
        {match.skill_name}
      </span>
    )
  }

  return (
    <div className={`flex flex-col ${isInline ? 'h-full' : 'h-[calc(100vh-56px)]'} bg-gray-50 dark:bg-gray-950`}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center gap-4 shrink-0">
        <button
          onClick={() => isInline ? onClose?.() : navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-accent hover:bg-accent-100 dark:hover:bg-accent/20 transition-all"
          aria-label={isInline ? 'Close' : 'Back'}
        >
          {isInline ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-gray-900 dark:text-gray-100 text-lg truncate">{data.candidate_name}</h1>
            <StatusBadge status={(
              data.shortlist_status === 'shortlisted' ? 'shortlisted'
              : data.shortlist_status === 'rejected' ? 'rejected'
              : data.shortlist_status === 'review' ? 'review'
              : data.status === 'pending' ? 'review'
              : data.status
            ) as Parameters<typeof StatusBadge>[0]['status']} />
            {reparseDone ? (
              <span className="text-xs text-success font-medium">Re-parsed</span>
            ) : (
              <button
                onClick={() => reparseMut.mutate()}
                disabled={reparseMut.isPending}
                title="Re-extract name and graduation year from resume text"
                className="text-xs text-gray-400 hover:text-accent dark:hover:text-accent-300 transition-colors disabled:opacity-40"
              >
                {reparseMut.isPending ? 'Re-parsing…' : '↺ Re-parse name'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{data.candidate_email}</p>
            {data.email_sent_at && (
              <span
                title={`Sent ${new Date(data.email_sent_at).toLocaleString()}`}
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${data.email_opened_at
                    ? 'bg-success-100 text-success-800'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}
              >
                {data.email_opened_at ? (
                  <>
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    Opened {new Date(data.email_opened_at).toLocaleDateString()}
                  </>
                ) : (
                  <>
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Sent {new Date(data.email_sent_at).toLocaleDateString()}
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Schedule interview button */}
          <div className="relative">
            <button
              onClick={() => setShowSchedule((v) => !v)}
              className={`flex items-center gap-2 text-sm font-medium border rounded-lg px-3 py-2 transition-all ${
                data.interview_scheduled_at
                  ? 'border-accent text-accent bg-accent-100 dark:bg-accent-900'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-accent hover:text-accent bg-white dark:bg-gray-800'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {data.interview_scheduled_at
                ? new Date(data.interview_scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                : 'Schedule'}
              {scheduleSaved && <span className="text-[10px] text-success font-bold ml-1">✓</span>}
            </button>
            {showSchedule && (
              <div className="absolute top-[calc(100%+6px)] right-0 z-50 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Schedule Interview</p>
                <div>
                  <label className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 block">Date & Time</label>
                  <input
                    type="datetime-local"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 block">Video Call Link (optional)</label>
                  <input
                    type="url"
                    value={scheduleLink}
                    onChange={(e) => setScheduleLink(e.target.value)}
                    placeholder="https://meet.google.com/…"
                    className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => scheduleMut.mutate()}
                    disabled={scheduleMut.isPending || !scheduleDate}
                    className="flex-1 bg-accent hover:bg-accent-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg py-2 transition-colors"
                  >
                    {scheduleMut.isPending ? 'Saving…' : 'Save'}
                  </button>
                  {data.interview_scheduled_at && (
                    <button
                      onClick={() => { setScheduleDate(''); setScheduleLink(''); scheduleMut.mutate() }}
                      className="px-3 py-2 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                  <button onClick={() => setShowSchedule(false)} className="px-3 py-2 text-xs text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowPdfViewer(true)}
            className="flex items-center gap-2 text-sm font-medium border border-accent/40 rounded-lg px-3 py-2 text-accent bg-accent-100/50 hover:bg-accent-100 dark:bg-accent-900/40 dark:hover:bg-accent-900 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            View with PDF
          </button>

          <button
            onClick={() => setShowEmailModal(true)}
            className="flex items-center gap-2 text-sm font-medium border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-600 dark:text-gray-300 hover:border-accent hover:text-accent dark:hover:border-accent dark:hover:text-accent-300 transition-all bg-white dark:bg-gray-800"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Email Candidate
          </button>
        </div>

      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 flex gap-0 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => isInline ? setInlineTab(tab.key) : setSearchParams({ tab: tab.key }, { replace: true })}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.key
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-accent dark:hover:text-accent-300'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {/* Tab 1: Score Breakdown */}
        {activeTab === 'breakdown' && (
          <div className="flex min-h-full">

            {/* Left column — no own scroll; outer flex-1 overflow-y-auto handles it */}
            <div className="flex-1 p-6 space-y-4">

              {/* Skills Match */}
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Skills Match</h3>

                {/* Legend */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {Object.entries(SKILL_CHIP_LABELS).map(([key, label]) => (
                    <span key={key} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${SKILL_CHIP_STYLES[key]}`}>
                      {label}
                    </span>
                  ))}
                </div>

                <div className="space-y-4">
                  {foundInProjects.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Projects &amp; Experience</p>
                      <div className="flex flex-wrap gap-1.5">
                        {foundInProjects.map((m: SkillMatch) => <SkillChip key={m.skill_name} match={m} />)}
                      </div>
                    </div>
                  )}
                  {foundInSkills.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Skills Section</p>
                      <div className="flex flex-wrap gap-1.5">
                        {foundInSkills.map((m: SkillMatch) => <SkillChip key={m.skill_name} match={m} />)}
                      </div>
                    </div>
                  )}
                  {foundInEducation.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">In Education</p>
                      <div className="flex flex-wrap gap-1.5">
                        {foundInEducation.map((m: SkillMatch) => <SkillChip key={m.skill_name} match={m} />)}
                      </div>
                    </div>
                  )}
                  {foundOther.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Other</p>
                      <div className="flex flex-wrap gap-1.5">
                        {foundOther.map((m: SkillMatch) => <SkillChip key={m.skill_name} match={m} />)}
                      </div>
                    </div>
                  )}
                  {missing.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Missing Skills</p>
                      <div className="flex flex-wrap gap-1.5">
                        {missing.map((skill: string) => (
                          <span key={skill} className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-600">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Confidence tiers */}
                {data.confidence_tiers && (
                  (data.confidence_tiers.high.length + data.confidence_tiers.medium.length + data.confidence_tiers.low.length) > 0
                ) && (
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Confidence by match quality</p>
                      <div className="space-y-1.5">
                        {data.confidence_tiers!.high.length > 0 && (
                          <div className="flex items-start gap-2">
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-success-100 text-success-800 border border-success-300/50 shrink-0 mt-0.5">High</span>
                            <p className="text-xs text-gray-600 dark:text-gray-300">{data.confidence_tiers!.high.join(', ')}</p>
                          </div>
                        )}
                        {data.confidence_tiers!.medium.length > 0 && (
                          <div className="flex items-start gap-2">
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-warning-100 text-warning-800 border border-warning/50 shrink-0 mt-0.5">Mid</span>
                            <p className="text-xs text-gray-600 dark:text-gray-300">{data.confidence_tiers!.medium.join(', ')}</p>
                          </div>
                        )}
                        {data.confidence_tiers!.low.length > 0 && (
                          <div className="flex items-start gap-2">
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 shrink-0 mt-0.5">Low</span>
                            <p className="text-xs text-gray-600 dark:text-gray-300">{data.confidence_tiers!.low.join(', ')}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>

              {/* Requirements Breakdown */}
              {data.requirements_breakdown && data.requirements_breakdown.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Requirements Breakdown</h3>
                  <div className="space-y-4">
                    {data.requirements_breakdown.map((rb: RequirementBreakdown) => {
                      const color = rb.score >= 75 ? '#1D9E75' : rb.score >= 40 ? '#EF9F27' : '#E24B4A'
                      return (
                        <div key={rb.requirement_id}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{rb.label}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0">{rb.req_type}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-3">
                              <span className="text-[10px] text-gray-400">w:{rb.weight}%</span>
                              <span className="text-xs font-semibold" style={{ color }}>{Math.round(rb.score)}%</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-1.5 rounded-full transition-all" style={{ width: `${rb.score}%`, backgroundColor: color }} />
                          </div>
                          {rb.evidence && (
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 truncate" title={rb.evidence}>{rb.evidence}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* AI Analysis */}
              {data.reasoning_summary && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">AI Analysis</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-100 dark:bg-accent/20 text-accent-700 dark:text-accent-300 border border-accent-300/40">AI</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {data.reasoning_summary
                      .replace(/\(TF-IDF\)/g, '')
                      .replace(/\bTF-IDF\b/g, 'keyword relevance')
                      .replace(/relevance score (\d+\.\d+)/g, (_: string, n: string) => `relevance score ${Math.round(parseFloat(n) * 100)}%`)
                    }
                  </p>
                </div>
              )}

              {/* Cover Letter */}
              {data.cover_letter && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Cover Letter</h3>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {data.cover_letter}
                  </p>
                </div>
              )}

              {/* Screening Question Answers */}
              {data.screening_answers && data.screening_answers.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">Screening Questions</h3>
                    {data.knockout_failed && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger-100 text-danger-800 border border-danger/40">
                        Knockout answer
                      </span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {data.screening_answers.map((a) => (
                      <div key={a.question_id}>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{a.question_text}</p>
                        <p className={`text-sm mt-0.5 ${a.is_knockout ? 'text-danger font-semibold' : 'text-gray-700 dark:text-gray-300'}`}>
                          {a.answer}{a.is_knockout ? ' ⚠' : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Interview Prep Questions — disabled, uncomment to restore
              {data.interview_questions && data.interview_questions.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">Interview Prep Questions</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E1F5FE] text-[#004D7A] border border-[#74C2F1]/40">AI Generated</span>
                  </div>
                  <ol className="space-y-2.5 list-none">
                    {data.interview_questions.map((q, i) => (
                      <li key={i} className="flex gap-3 text-sm text-gray-700 dark:text-gray-300">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-accent-100 dark:bg-accent/30 text-accent dark:text-accent-300 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                        <span className="leading-relaxed">{q}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              */}

              {/* Top Matched Excerpt */}
              {data.excerpts && data.excerpts.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Top Matched Excerpt</h3>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    <p>{data.excerpts[0]}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Right sidebar — sticky so it stays in view while left column scrolls */}
            <aside className="w-64 shrink-0 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 p-5 flex flex-col gap-5 sticky top-0 self-start max-h-screen overflow-y-auto">


              {/* Score circle */}
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Overall Score</p>
                <ScoreCircle score={data.total_score} />
              </div>

              {/* Section Scores */}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Section Breakdown</p>
                <div className="space-y-3">
                  {[
                    { label: 'Projects', score: data.project_score },
                    { label: 'Skills', score: data.skill_score },
                    { label: 'Education', score: data.education_score },
                  ].map(({ label, score }) => (
                    <div key={label}>
                      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                        <span>{label}</span>
                        <span className="font-medium text-gray-700 dark:text-gray-300">{Math.round(score)}</span>
                      </div>
                      <ScoreBar score={score} showLabel={false} />
                    </div>
                  ))}
                </div>
              </div>

              {data.tfidf_score != null && (
                <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Keyword Relevance</p>
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                      <span>Keyword Relevance</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">{Math.round(data.tfidf_score * 100)}%</span>
                    </div>
                    <ScoreBar score={data.tfidf_score * 100} showLabel={false} />
                  </div>
                </div>
              )}

              {/* Candidate Info */}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Candidate</p>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{data.candidate_name}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 truncate">{data.candidate_email}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Role: <span className="text-gray-600 dark:text-gray-300">{data.job_role_title}</span>
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Evaluated: {new Date(data.evaluated_at).toLocaleDateString()}
                </p>

                {/* Social links */}
                {(data.github_url || data.linkedin_url || data.portfolio_url) && (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {data.github_url && (
                      <a href={data.github_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors truncate"
                        title={data.github_url}>
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                        GitHub
                      </a>
                    )}
                    {data.linkedin_url && (
                      <a href={data.linkedin_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-[#0A66C2] transition-colors truncate"
                        title={data.linkedin_url}>
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                        </svg>
                        LinkedIn
                      </a>
                    )}
                    {data.portfolio_url && (
                      <a href={data.portfolio_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-accent dark:hover:text-accent-300 transition-colors truncate"
                        title={data.portfolio_url}>
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                        </svg>
                        Portfolio
                      </a>
                    )}
                  </div>
                )}

                {/* Tags */}
                <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Tags</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(data.tags ?? []).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent-100 text-accent dark:bg-accent-900 dark:text-accent-300"
                      >
                        {tag}
                        <button
                          onClick={() => removeTag(tag)}
                          disabled={tagsMut.isPending}
                          aria-label={`Remove tag ${tag}`}
                          className="hover:text-red-500 leading-none disabled:opacity-50"
                        >×</button>
                      </span>
                    ))}
                    {(data.tags ?? []).length === 0 && (
                      <span className="text-xs text-gray-300 dark:text-gray-600">No tags yet</span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                      placeholder="Add a tag…"
                      maxLength={40}
                      className="flex-1 min-w-0 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40"
                    />
                    <button
                      onClick={addTag}
                      disabled={!newTag.trim() || tagsMut.isPending}
                      className="px-2.5 py-1 text-xs font-semibold bg-accent hover:bg-accent-700 disabled:opacity-50 text-white rounded-lg transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* Resume Text tab — hidden (available via re-classify on Score Breakdown) */}
        {false && activeTab === 'breakdown' && data && (
          <div className="p-6 space-y-4">
            {localSections.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">Resume Sections</h3>
                  <div className="flex items-center gap-3">
                    {sectionsSaved && <span className="text-xs text-success font-medium">Re-scoring started…</span>}
                    {reclassifyMut.isError && <span className="text-xs text-danger-800">Failed</span>}
                    <button
                      onClick={() => reclassifyMut.mutate()}
                      disabled={reclassifyMut.isPending}
                      className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-1.5 transition-colors"
                    >
                      {reclassifyMut.isPending ? 'Re-classifying…' : 'Re-classify & Re-score'}
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {localSections.map((sec, idx) => {
                    const sectionColors: Record<string, string> = {
                      projects: '#1D9E75', work_experience: '#1D9E75', experience: '#1D9E75',
                      skills_section: '#534AB7', skills: '#534AB7', certifications: '#534AB7',
                      education: '#004D7A', summary: '#EF9F27', objective: '#EF9F27',
                      awards: '#6B7280', publications: '#6B7280', volunteer: '#6B7280',
                      languages: '#6B7280', interests: '#6B7280', unknown: '#9CA3AF',
                    }
                    const color = sectionColors[sec.type] ?? '#9CA3AF'
                    const confPct = Math.round((sec.confidence ?? 0) * 100)
                    const isExpanded = expandedSections.has(idx)
                    return (
                      <div key={idx} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                        {/* Section header */}
                        <div
                          onClick={() => toggleSection(idx)}
                          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40 select-none transition-colors"
                        >
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-full text-white shrink-0"
                            style={{ backgroundColor: color }}
                          >
                            {sec.type.replace('_', ' ')}
                          </span>
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 flex-1 truncate">
                            {sec.title || `Lines ${sec.start_line}–${sec.end_line}`}
                          </span>
                          {/* Confidence bar */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="w-16 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${confPct}%`,
                                  backgroundColor: confPct >= 80 ? '#1D9E75' : confPct >= 50 ? '#EF9F27' : '#E24B4A',
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 w-7 text-right">{confPct}%</span>
                          </div>
                          {/* Expand toggle */}
                          <span
                            className="text-xs text-gray-400 dark:text-gray-500 transition-colors shrink-0 ml-1"
                          >
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        </div>
                        {/* Section text — collapsible */}
                        {isExpanded && sec.text && (
                          <pre className="whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-300 leading-relaxed font-mono bg-gray-50 dark:bg-gray-800 px-4 py-3 border-t border-gray-100 dark:border-gray-700 max-h-48 overflow-auto">
                            {sec.text}
                          </pre>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Full Resume Text</h3>
                <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 leading-relaxed font-mono bg-gray-50 dark:bg-gray-800 rounded-lg p-4 overflow-auto max-h-[60vh]">
                  {data?.resume_text || 'No text extracted.'}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Enrichment */}
        {activeTab === 'enrichment' && data && (
          <EnrichmentTab
            candidateId={data.candidate_id}
            jobRoleId={data.job_role_id}
            portfolioUrl={data.portfolio_url}
            initialGhUrl={data.github_url ?? undefined}
            initialLiUrl={data.linkedin_url ?? undefined}
          />
        )}


        {/* Tab 3: Notes & Feedback (Annotations + Interview Feedback + Team Comments) */}
        {activeTab === 'collaboration' && data && (
          <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-800">
            {/* Annotations */}
            <div className="p-6">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100">Annotations</h3>

              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Shortlist Status</label>
                <select
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40"
                  value={noteStatus}
                  onChange={(e) => setNoteStatus(e.target.value as ShortlistStatus)}
                >
                  <option value="shortlisted">Shortlisted</option>
                  <option value="review">Review</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Notes</label>
                <textarea rows={5}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none"
                  placeholder="Add notes about this candidate…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-3">
                <button onClick={() => shortlistMut.mutate()} disabled={shortlistMut.isPending}
                  className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white font-semibold rounded-lg px-5 py-2 text-sm transition-colors">
                  {shortlistMut.isPending ? 'Saving…' : 'Save'}
                </button>
                {noteSaved && <span className="text-xs text-success font-medium">Saved successfully</span>}
                {shortlistMut.isError && <span className="text-xs text-danger-800">Save failed</span>}
              </div>
            </div>
            </div>

            {/* Interview Feedback */}
            <FeedbackTab candidateId={data.candidate_id} evaluationId={evaluationId} />

            {/* Team Comments */}
            <CommentsTab candidateId={data.candidate_id} />
          </div>
        )}
      </div>

      {showPdfViewer && (
        <PdfSplitView
          detail={data}
          resumeId={data.resume_id}
          onClose={() => setShowPdfViewer(false)}
        />
      )}

      {showEmailModal && (
        <EmailComposerModal
          evaluationId={evaluationId}
          candidateName={data.candidate_name}
          jobTitle={data.job_role_title}
          score={data.total_score}
          yearsExperience={null}
          defaultTemplateKey={data.shortlist_status === 'rejected' ? 'rejection' : undefined}
          onClose={() => setShowEmailModal(false)}
          onSent={() => setShowEmailModal(false)}
        />
      )}

    </div>
  )
}
