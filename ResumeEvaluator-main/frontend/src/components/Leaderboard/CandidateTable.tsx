import { useNavigate } from 'react-router-dom'
import { useRef, useEffect, useState } from 'react'
import { useConfirm } from '../shared/ConfirmDialog'
import { getInitials } from '../../lib/utils'

import StatusBadge from '../StatusBadge'
import EmailComposerModal from './EmailComposerModal'
import type { CandidateResult, JobRole } from '../../api/client'


interface CandidateTableProps {
  items: CandidateResult[]
  isLoading: boolean
  isError: boolean
  selectedIds: Set<number>
  toggleSelectAll: () => void
  selectAllLoading?: boolean
  totalEvaluated: number
  toggleSelect: (id: number) => void
  blindMode: boolean
  maskName: (name: string, index: number) => string
  maskEmail: (email: string | null | undefined) => string | null
  isAdmin: boolean
  stageMut: any
  sendEmailMut?: any
  emailMsg?: { id: number; msg: string } | null
  deleteMutation: any
  groupByExp: boolean
  page: number
  PAGE_SIZE: number
  sortKey: any
  sortDir: 'asc' | 'desc'
  toggleSort: (key: any) => void
  selectedRole: JobRole | null
  onOpenPreview?: (resumeId: number, name: string) => void
  onManualEval?: (item: CandidateResult) => void
  onRowClick?: (item: CandidateResult) => void
  onRefresh?: () => void
  sandboxScoreFn?: (item: CandidateResult) => number
}

function RankBadge({ rank }: { rank: number }) {
  const labels: Record<number, string> = { 1: 'First place', 2: 'Second place', 3: 'Third place' }
  const emojis: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
  if (rank <= 3) {
    return (
      <span role="img" aria-label={labels[rank]} className="text-base">
        {emojis[rank]}
      </span>
    )
  }
  return (
    <span
      aria-label={`Rank ${rank}`}
      className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[11px] font-bold flex items-center justify-center"
    >
      {rank}
    </span>
  )
}

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

function formatDate(iso: string) {
  const d = new Date(iso)
  const month = d.toLocaleDateString(undefined, { month: 'short' })
  const day = d.getDate()
  const year = String(d.getFullYear()).slice(2)
  return `${month} ${day}, '${year}`
}

const STAGE_COLORS: Record<string, string> = {
  applied:   'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600',
  screening: 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300 border-accent-300',
  coding:    'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700',
  interview: 'bg-warning-100 text-warning-800 border-warning',
  offer:     'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700',
  hired:     'bg-success-100 text-success-800 border-success-300',
  rejected:  'bg-danger-100 text-danger-800 border-danger/50',
}

const STAGE_LABELS: Record<string, string> = {
  applied: 'Applied', screening: 'Screening', coding: 'Coding Test',
  interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected',
}

// ─── Compact email cell — opens EmailComposerModal ───────────────────────────
function EmailCell({
  item,
  onOpenComposer,
}: {
  item: CandidateResult
  onOpenComposer: (item: CandidateResult) => void
}) {
  if (!item.candidate_email) {
    return <span className="text-[10px] text-gray-300 dark:text-gray-600">No email</span>
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      {item.email_sent_at && (
        <>
          <span className="text-[10px] text-success font-semibold flex items-center gap-0.5">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Sent
          </span>
          {item.email_opened_at ? (
            <span className="text-[10px] text-success flex items-center gap-0.5" title={`Opened ${new Date(item.email_opened_at).toLocaleString()}`}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Opened
            </span>
          ) : (
            <span className="text-[10px] text-gray-400">Not opened</span>
          )}
        </>
      )}
      <button
        onClick={() => onOpenComposer(item)}
        className="p-1.5 rounded-lg border border-accent/40 text-accent hover:bg-accent-100 dark:hover:bg-accent-900 transition-colors print:hidden"
        title={item.email_sent_at ? 'Compose another email' : 'Compose email'}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </button>
    </div>
  )
}

export default function CandidateTable({
  items,
  isLoading,
  isError,
  selectedIds,
  toggleSelectAll,
  selectAllLoading,
  totalEvaluated,
  toggleSelect,
  blindMode,
  maskName,
  maskEmail,
  isAdmin,
  stageMut,
  deleteMutation,
  groupByExp,
  page,
  PAGE_SIZE,
  sortKey,
  sortDir,
  toggleSort,
  selectedRole: _selectedRole,
  onOpenPreview,
  onManualEval,
  onRowClick,
  onRefresh,
  sandboxScoreFn,
}: CandidateTableProps) {
  const navigate = useNavigate()
  const tableRef = useRef<HTMLTableElement>(null)
  const theadRef = useRef<HTMLTableSectionElement>(null)
  const [composerItem, setComposerItem] = useState<any | null>(null)
  const confirm = useConfirm()

  useEffect(() => {
    const mainEl = document.querySelector('main')
    const tableEl = tableRef.current
    const theadEl = theadRef.current
    if (!mainEl || !tableEl || !theadEl) return
    let active = true
    const handleScroll = () => {
      if (!active) return
      const mainRect = mainEl.getBoundingClientRect()
      const tableRect = tableEl.getBoundingClientRect()
      const offsetTop = tableRect.top - mainRect.top
      if (offsetTop < 0) {
        const theadHeight = theadEl.offsetHeight
        const maxTranslate = tableRect.height - theadHeight - 40
        const translateAmount = Math.max(0, Math.min(-offsetTop, maxTranslate))
        theadEl.style.transform = `translateY(${translateAmount}px)`
        theadEl.style.position = 'relative'
        theadEl.style.zIndex = '20'
      } else {
        theadEl.style.transform = 'translateY(0px)'
      }
    }
    mainEl.addEventListener('scroll', handleScroll)
    handleScroll()
    window.addEventListener('resize', handleScroll)
    return () => {
      active = false
      mainEl.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [items])

  function SortIcon({ k }: { k: string }) {
    if (sortKey !== k) return <span className="text-gray-300 ml-0.5">↕</span>
    return <span className="text-accent ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  const TH = 'sticky top-0 z-10 bg-gray-50/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-100 dark:border-gray-700 text-left px-2 py-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400'

  // Detect candidates appearing more than once (same candidate_id, different evaluations)
  const candidateIdCounts = items.reduce<Record<number, number>>((acc, it) => {
    acc[it.candidate_id] = (acc[it.candidate_id] ?? 0) + 1
    return acc
  }, {})
  const duplicateCandidateIds = new Set(
    Object.entries(candidateIdCounts).filter(([, c]) => c > 1).map(([id]) => Number(id))
  )

  const renderRow = (item: CandidateResult, idx: number) => (
    <tr
      key={item.evaluation_id}
      className={`border-b border-gray-50 dark:border-gray-800 hover:bg-accent-100/20 dark:hover:bg-accent/10 cursor-pointer transition-colors duration-100 ${selectedIds.has(item.evaluation_id) ? 'bg-accent-100/40 dark:bg-accent-900/40' : ''}`}
      onClick={() => onRowClick ? onRowClick(item) : navigate(`/results/${item.evaluation_id}`)}
    >
      {/* Checkbox */}
      <td className="px-2 py-1.5 w-8 no-print" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="rounded border-gray-300 dark:border-gray-600 accent-accent"
          checked={selectedIds.has(item.evaluation_id)}
          onChange={() => toggleSelect(item.evaluation_id)}
        />
      </td>

      {/* Rank — w-8 */}
      <td className="px-2 py-1.5 w-8">
        <RankBadge rank={idx + 1} />
      </td>

      {/* Candidate — w-52 */}
      <td className="px-2 py-1.5 w-52">
        <div className="flex items-center gap-1.5">
          {!blindMode && (
            <button
              title="Preview resume PDF"
              onClick={(e) => { e.stopPropagation(); onOpenPreview?.(item.resume_id, displayName(item.candidate_name, item.candidate_email)) }}
              className="w-5 h-5 flex items-center justify-center rounded text-gray-300 dark:text-gray-600 hover:text-accent hover:bg-accent-100 dark:hover:bg-accent-900 transition-colors shrink-0 no-print"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
          )}
          <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
            <span className="text-[10px] text-white font-bold">
              {blindMode ? `C${idx + 1}` : getInitials(displayName(item.candidate_name, item.candidate_email))}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate max-w-[160px]">
                {maskName(displayName(item.candidate_name, item.candidate_email), idx)}
              </p>
              {!blindMode && item.needs_manual_review && (
                <span title="Manual review required" className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-danger-100 text-danger shrink-0">
                  <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                </span>
              )}
              {!blindMode && duplicateCandidateIds.has(item.candidate_id) && (
                <span title="This candidate appears multiple times in the results" className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700 shrink-0">
                  DUP
                </span>
              )}
              {!blindMode && item.github_skill_gap_severity && item.github_skill_gap_severity !== 'low' && (
                item.github_url ? (
                  <a href={item.github_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex shrink-0">
                    <span
                      title={item.github_skill_gap_severity === 'high' ? 'GitHub: skills not evidenced (high)' : 'GitHub: some skills unverified'}
                      className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full ${item.github_skill_gap_severity === 'high' ? 'bg-danger-100 text-danger' : 'bg-warning-100 text-warning'}`}
                    >
                      <svg className="w-2 h-2" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                      </svg>
                    </span>
                  </a>
                ) : (
                  <span
                    title={item.github_skill_gap_severity === 'high' ? 'GitHub: skills not evidenced (high)' : 'GitHub: some skills unverified'}
                    className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full shrink-0 ${item.github_skill_gap_severity === 'high' ? 'bg-danger-100 text-danger' : 'bg-warning-100 text-warning'}`}
                  >
                    <svg className="w-2 h-2" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                  </span>
                )
              )}
              {!blindMode && item.missed_requirements?.includes('GitHub') && (
                item.github_url ? (
                  <a href={item.github_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex shrink-0">
                    <span title="GitHub required but not provided" className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-red-50 dark:bg-red-950/30 text-red-500">
                      <svg className="w-2 h-2" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                      </svg>
                    </span>
                  </a>
                ) : (
                  <span title="GitHub required but not provided" className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-red-50 dark:bg-red-950/30 text-red-500 shrink-0">
                    <svg className="w-2 h-2" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                  </span>
                )
              )}
              {!blindMode && item.github_url && !(item.github_skill_gap_severity && item.github_skill_gap_severity !== 'low') && !item.missed_requirements?.includes('GitHub') && (
                <a
                  href={item.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Open GitHub Profile"
                  className="inline-flex items-center justify-center w-4 h-4 rounded text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors shrink-0"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                </a>
              )}
            </div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
              <span className="truncate max-w-[120px] block" title={maskEmail(item.candidate_email) ?? ''}>
                {maskEmail(item.candidate_email)}
              </span>
              {item.candidate_graduation_year != null && (
                <span className="shrink-0 text-[9px] font-medium bg-accent-100 dark:bg-accent-900 text-accent dark:text-accent-300 px-1.5 py-0.5 rounded" title="Graduation year">
                  {item.candidate_graduation_year}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* Title — w-24 */}
      <td className="px-2 py-1.5 w-24">
        {item.candidate_current_title ? (
          <p className="text-[11px] text-gray-600 dark:text-gray-300 truncate block max-w-[120px]" title={item.candidate_current_title}>
            {item.candidate_current_title}
          </p>
        ) : (
          <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
        )}
      </td>

      {/* Phone — w-24 */}
      <td className="px-2 py-1.5 w-24">
        <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400">{item.candidate_phone ?? '—'}</span>
      </td>

      {/* Location — w-28 */}
      <td className="px-2 py-1.5 w-28">
        {item.candidate_location ? (
          <span className="text-[11px] text-gray-600 dark:text-gray-300 truncate block max-w-[110px]" title={item.candidate_location}>
            <svg className="w-3 h-3 inline mr-0.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {item.candidate_location}
          </span>
        ) : (
          <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
        )}
      </td>

      {/* Score — w-12, centred */}
      <td className="px-2 py-1.5 w-12 text-center">
        {item.filter_stage === 'experience_filtered' ? (
          <span
            className="inline-block text-[9px] font-semibold px-1 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 leading-tight"
            title={`Auto-rejected: experience does not meet role requirements${item.candidate_years_experience != null ? ` (${item.candidate_years_experience.toFixed(1)} yr)` : ''}`}
          >
            Exp↓
          </span>
        ) : item.filter_stage === 'tfidf_filtered' ? (
          <span
            className="inline-block text-[9px] font-semibold px-1 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 leading-tight"
            title={`Auto-rejected: keyword relevance${item.tfidf_score != null ? ` ${(item.tfidf_score * 100).toFixed(0)}%` : ''} below threshold`}
          >
            Irrel.
          </span>
        ) : (
          (() => {
            const displayScore = sandboxScoreFn ? sandboxScoreFn(item) : item.total_score
            const rawScore = item.total_score
            return (
              <div className="flex flex-col items-center">
                <span
                  className="text-sm font-bold tabular-nums"
                  style={{ color: displayScore >= 75 ? '#1D9E75' : displayScore >= 50 ? '#EF9F27' : '#E24B4A' }}
                  title={sandboxScoreFn ? `Sandbox: ${displayScore.toFixed(1)} | Original: ${rawScore.toFixed(1)}` : `Score: ${rawScore.toFixed(1)}`}
                >
                  {Math.round(displayScore)}
                </span>
                {sandboxScoreFn && Math.abs(displayScore - rawScore) >= 0.5 && (
                  <span className="text-[10px] text-gray-400 tabular-nums">{Math.round(rawScore)}</span>
                )}
              </div>
            )
          })()

        )}
      </td>

      {/* Skills — w-28, max 2 chips */}
      <td className="px-2 py-1.5 w-28">
        <div className="flex flex-wrap gap-0.5">
          {(item.matched_skill_names ?? []).slice(0, 2).map((s: string) => (
            <span key={s} className="text-[10px] font-medium bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300 px-1 py-0.5 rounded-full border border-accent-300/60">
              {s}
            </span>
          ))}
          {(item.matched_skill_names ?? []).length > 2 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 px-0.5 py-0.5">
              +{item.matched_skill_names.length - 2}
            </span>
          )}
          {(item.matched_skill_names ?? []).length === 0 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{item.skills_matched}/{item.skills_total}</span>
          )}
        </div>
      </td>

      {/* Applied For — w-20 */}
      <td className="px-2 py-1.5 w-20">
        <span className="text-[11px] text-gray-700 dark:text-gray-300 font-medium truncate block max-w-[110px]" title={item.job_role_title}>
          {item.job_role_title}
        </span>
      </td>

      {/* Evaluated — w-16 */}
      <td className="px-2 py-1.5 w-16">
        <span className="text-[11px] text-gray-400 dark:text-gray-500">{item.evaluated_at ? formatDate(item.evaluated_at) : '—'}</span>
      </td>

      {/* Status — w-24 */}
      <td className="px-2 py-1.5 w-24">
        <StatusBadge
          status={(
            item.filter_stage === 'experience_filtered' || item.filter_stage === 'tfidf_filtered'
              ? 'rejected'
              : item.needs_manual_review && (item.status === 'done' || item.status === 'pending' || !item.status)
                ? 'review'
                : item.status === 'pending'
                  ? 'review'
                  : item.status
          ) as Parameters<typeof StatusBadge>[0]['status']}
        />
      </td>

      {/* Stage — w-20 */}
      <td className="px-2 py-1.5 w-20" onClick={(e) => e.stopPropagation()}>
        {isAdmin ? (
          <>
            <select
              value={item.candidate_stage ?? 'applied'}
              onChange={(e) => stageMut.mutate({ candidateId: item.candidate_id, evaluationId: item.evaluation_id, stage: e.target.value })}
              className={`text-[10px] font-semibold px-1 py-0.5 rounded border cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-accent/40 ${STAGE_COLORS[item.candidate_stage] ?? STAGE_COLORS.applied} print:hidden`}
              disabled={stageMut.isPending}
            >
              {Object.keys(STAGE_LABELS).map((s) => (
                <option key={s} value={s}>{STAGE_LABELS[s]}</option>
              ))}
            </select>
            <span className={`hidden print:inline-block text-[10px] font-semibold px-1 py-0.5 rounded border ${STAGE_COLORS[item.candidate_stage] ?? STAGE_COLORS.applied}`}>
              {STAGE_LABELS[item.candidate_stage] ?? 'Applied'}
            </span>
          </>
        ) : (
          <span className={`text-[10px] font-semibold px-1 py-0.5 rounded border ${STAGE_COLORS[item.candidate_stage] ?? STAGE_COLORS.applied}`}>
            {STAGE_LABELS[item.candidate_stage] ?? 'Applied'}
          </span>
        )}
      </td>

      {/* Email — w-12, icon-based */}
      {isAdmin && (
        <td className="px-2 py-1.5 w-12" onClick={(e) => e.stopPropagation()}>
          <EmailCell item={item} onOpenComposer={setComposerItem} />
        </td>
      )}

      {/* Actions — w-10 */}
      <td className="px-2 py-1.5 w-10 text-right no-print">
        <div className="flex items-center justify-end gap-0.5">
          {onManualEval && (
            <button
              onClick={(e) => { e.stopPropagation(); onManualEval(item) }}
              className="p-1 text-gray-400 hover:text-accent hover:bg-accent-100 dark:hover:bg-accent-900 rounded transition-colors"
              title="Manual evaluation — override score"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          <button
            onClick={async (e) => {
              e.stopPropagation()
              if (await confirm({
                title: 'Delete Result?',
                description: 'Delete this result? This cannot be undone.',
                intent: 'danger'
              })) {
                deleteMutation.mutate(item.evaluation_id)
              }
            }}
            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
            title="Delete result"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  )

  return (
    <>
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 min-w-0 w-full">
      <div className="overflow-x-auto overflow-y-clip w-full">
        {isLoading && (
          <table className="w-full text-sm animate-pulse">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                {[8, 32, 100, 76, 76, 48, 96, 70, 56, 80, 72, 48, 40].map((w, i) => (
                  <th key={i} className="px-2 py-2">
                    <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded" style={{ width: w }} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-800">
                  <td className="px-2 py-2"><div className="w-3.5 h-3.5 bg-gray-100 dark:bg-gray-700 rounded" /></td>
                  <td className="px-2 py-2"><div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded w-5" /></td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 shrink-0" />
                      <div className="space-y-1">
                        <div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded w-24" />
                        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded w-28" />
                      </div>
                    </div>
                  </td>
                  {[76, 76, 48, 96, 70, 56, 80, 72, 48, 40].map((w, j) => (
                    <td key={j} className="px-2 py-2"><div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded" style={{ width: w }} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {isError && (
          <div className="p-8 text-center text-sm text-danger-800">Failed to load results.</div>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">No results found.</div>
        )}
        {items.length > 0 && (
          <table ref={tableRef} className="w-full text-sm">
            <thead ref={theadRef} className="sticky top-0 z-10">
              <tr className="bg-gray-50 dark:bg-gray-800">
                <th className={`${TH} w-8 no-print`}>
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 dark:border-gray-600 accent-accent disabled:opacity-50"
                    checked={items.length > 0 && selectedIds.size === totalEvaluated}
                    disabled={!!selectAllLoading}
                    title={selectAllLoading ? 'Selecting all matching candidates…' : undefined}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className={`${TH} w-8`}>Rank</th>
                <th className={`${TH} w-52 cursor-pointer`} onClick={() => toggleSort('candidate_name')}>
                  Candidate <SortIcon k="candidate_name" />
                </th>
                <th className={`${TH} w-24 cursor-pointer`} onClick={() => toggleSort('current_title')}>
                  Title <SortIcon k="current_title" />
                </th>
                <th className={`${TH} w-24`}>Phone</th>
                <th className={`${TH} w-28 cursor-pointer`} onClick={() => toggleSort('candidate_location')}>
                  Location <SortIcon k="candidate_location" />
                </th>
                <th className={`${TH} w-12 text-center cursor-pointer`} onClick={() => toggleSort('total_score')}>
                  Score <SortIcon k="total_score" />
                </th>
                <th className={`${TH} w-28 cursor-pointer`} onClick={() => toggleSort('skills_matched')}>
                  Skills <SortIcon k="skills_matched" />
                </th>
                <th className={`${TH} w-20 cursor-pointer`} onClick={() => toggleSort('job_role_title')}>
                  Applied For <SortIcon k="job_role_title" />
                </th>
                <th className={`${TH} w-16`}>Evaluated</th>
                <th className={`${TH} w-24`}>Status</th>
                <th className={`${TH} w-20`}>Stage</th>
                {isAdmin && <th className={`${TH} w-12`}>Email</th>}
                <th className={`${TH} w-10 text-right no-print`}></th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const EXP_ORDER = ['executive', 'senior', 'mid', 'junior', 'entry']
                const EXP_LABELS: Record<string, string> = {
                  executive: 'Executive / Lead', senior: 'Senior',
                  mid: 'Mid-level', junior: 'Junior', entry: 'Entry Level',
                }
                const EXP_COLORS: Record<string, string> = {
                  executive: 'bg-danger-100 text-danger-800 border-danger',
                  senior: 'bg-accent-100 text-accent-700 border-accent-300',
                  mid: 'bg-success-100 text-success-800 border-success-300',
                  junior: 'bg-warning-100 text-warning-800 border-warning',
                  entry: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-500',
                }

                if (!groupByExp) {
                  return items.map((item, idx) => renderRow(item, (page - 1) * PAGE_SIZE + idx))
                }

                const groups = EXP_ORDER.map((level) => ({
                  level,
                  rows: items.filter((r) => (r.candidate_experience_level ?? 'entry') === level),
                })).filter((g) => g.rows.length > 0)

                let globalIdx = (page - 1) * PAGE_SIZE
                return groups.flatMap(({ level, rows }) => [
                  <tr key={`group-${level}`} className="bg-gray-50 dark:bg-gray-800/60">
                    <td colSpan={isAdmin ? 14 : 13} className="px-3 py-1.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${EXP_COLORS[level]}`}>
                        {EXP_LABELS[level]}
                      </span>
                      <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500">{rows.length} candidate{rows.length !== 1 ? 's' : ''}</span>
                    </td>
                  </tr>,
                  ...rows.map((item) => renderRow(item, globalIdx++)),
                ])
              })()}
            </tbody>
          </table>
        )}
      </div>
    </div>
    {composerItem && (
      <EmailComposerModal
        evaluationId={composerItem.evaluation_id}
        candidateName={composerItem.candidate_name}
        jobTitle={composerItem.job_role_title}
        score={composerItem.total_score}
        yearsExperience={composerItem.candidate_years_experience ?? null}
        onClose={() => setComposerItem(null)}
        onSent={() => { setComposerItem(null); onRefresh?.() }}
      />
    )}
    </>
  )
}
