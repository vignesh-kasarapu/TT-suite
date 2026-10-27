import { useMemo, useState } from 'react'
import ScoreBar from '../ScoreBar'
import CandidateDetail from '../../pages/CandidateDetail'
import type { ReportDrilldownCandidate } from '../../api/client'

const STAGE_STYLES: Record<string, string> = {
  applied: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600',
  screening: 'bg-accent-100 text-accent-700 border-accent-300',
  coding: 'bg-accent-100 text-accent border-accent-300',
  interview: 'bg-[#FEF6E7] text-[#8A5A00] border-warning',
  offer: 'bg-success-100 text-success-800 border-success-300',
  hired: 'bg-success-100 text-success-800 border-success-300',
  rejected: 'bg-danger-100 text-danger-800 border-danger',
  withdrawn: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600',
}

const STAGE_LABELS: Record<string, string> = {
  applied: 'Applied', screening: 'Screening', coding: 'Coding Test', interview: 'Interview',
  offer: 'Offer', hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn',
}

function StageBadge({ stage }: { stage: string }) {
  const classes = STAGE_STYLES[stage] ?? STAGE_STYLES.applied
  return (
    <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full border whitespace-nowrap ${classes}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  )
}

interface CandidateDrilldownTableProps {
  candidates: ReportDrilldownCandidate[]
  total: number
  isLoading: boolean
  contextLabel?: string
}

export default function CandidateDrilldownTable({ candidates, total, isLoading, contextLabel }: CandidateDrilldownTableProps) {
  const [openEvaluationId, setOpenEvaluationId] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return candidates
    return candidates.filter((c) =>
      c.candidate_name.toLowerCase().includes(term) ||
      c.matched_skill_names.some((s) => s.toLowerCase().includes(term))
    )
  }, [candidates, search])

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">Candidates</h2>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or skill…"
          className="flex-1 max-w-xs text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
        />
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {isLoading
            ? 'Loading…'
            : `Showing ${filtered.length} of ${total} candidate${total === 1 ? '' : 's'}${contextLabel ? ` — ${contextLabel}` : ''}`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Stage</th>
              <th className="px-4 py-2 font-medium">Fit Score</th>
              <th className="px-4 py-2 font-medium">Skills</th>
              <th className="px-4 py-2 font-medium">Experience</th>
              <th className="px-4 py-2 font-medium">Evaluated</th>
              <th className="px-4 py-2 font-medium">Summary</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map((c) => (
              <tr key={c.evaluation_id} className="text-gray-700 dark:text-gray-300 align-top">
                <td className="px-4 py-2 font-medium whitespace-nowrap">{c.candidate_name}</td>
                <td className="px-4 py-2 whitespace-nowrap">{c.candidate_email ?? '—'}</td>
                <td className="px-4 py-2 whitespace-nowrap">{c.job_role_title ?? '—'}</td>
                <td className="px-4 py-2"><StageBadge stage={c.stage} /></td>
                <td className="px-4 py-2 w-24"><ScoreBar score={c.total_score} /></td>
                <td className="px-4 py-2 whitespace-nowrap" title={c.matched_skill_names.join(', ')}>
                  {c.skills_total > 0 ? `${c.skills_matched}/${c.skills_total}` : '—'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {c.experience_level ?? '—'}{c.years_experience != null ? ` · ${c.years_experience}y` : ''}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{c.evaluated_at ? c.evaluated_at.slice(0, 10) : '—'}</td>
                <td className="px-4 py-2 max-w-xs truncate" title={c.reasoning_summary ?? ''}>{c.reasoning_summary ?? '—'}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => setOpenEvaluationId(c.evaluation_id)}
                    className="text-xs font-medium text-accent hover:text-accent-700 whitespace-nowrap"
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-gray-400">
                  {candidates.length === 0 ? 'No candidates match this selection.' : 'No candidates match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openEvaluationId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] overflow-hidden">
            <CandidateDetail inlineId={openEvaluationId} onClose={() => setOpenEvaluationId(null)} />
          </div>
        </div>
      )}
    </div>
  )
}
