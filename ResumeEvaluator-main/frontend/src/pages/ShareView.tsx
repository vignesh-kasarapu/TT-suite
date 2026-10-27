import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getShareView, submitShareVote } from '../api/client'
import type { ShareCandidateOut } from '../api/client'
import ScoreBar from '../components/ScoreBar'
import { useAppStore } from '../store/useAppStore'

function randomToken(): string {
  // crypto.randomUUID() requires a secure context (HTTPS) and isn't available
  // in every older in-app/embedded browser a reviewer might open a share link
  // in — fall back to a Math.random()-based token rather than crashing this
  // public, unauthenticated page with no error boundary of its own.
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

function getVoterToken(): string {
  const key = 'share-voter-token'
  let t = localStorage.getItem(key)
  if (!t) {
    t = randomToken()
    localStorage.setItem(key, t)
  }
  return t
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 75 ? '#1D9E75' : score >= 50 ? '#EF9F27' : '#E24B4A'
  return (
    <div className="flex flex-col items-center">
      <span className="text-2xl font-black tabular-nums" style={{ color }}>{Math.round(score)}</span>
      <span className="text-[10px] text-gray-400 uppercase tracking-wide">Score</span>
    </div>
  )
}

function VoteButtons({
  candidate,
  onVote,
  loading,
}: {
  candidate: ShareCandidateOut
  onVote: (evalId: number, vote: 'up' | 'down' | 'clear') => void
  loading: boolean
}) {
  const { upvotes, downvotes, my_vote, evaluation_id } = candidate

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onVote(evaluation_id, my_vote === 'up' ? 'clear' : 'up')}
        disabled={loading}
        className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-all ${
          my_vote === 'up'
            ? 'bg-success-100 text-success-800 border-success-300'
            : 'bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-600 hover:border-success-300 hover:text-success'
        }`}
      >
        <svg className="w-3.5 h-3.5" fill={my_vote === 'up' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
        {upvotes}
      </button>
      <button
        onClick={() => onVote(evaluation_id, my_vote === 'down' ? 'clear' : 'down')}
        disabled={loading}
        className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-all ${
          my_vote === 'down'
            ? 'bg-danger-100 text-danger-800 border-danger/50'
            : 'bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-600 hover:border-danger/50 hover:text-danger'
        }`}
      >
        <svg className="w-3.5 h-3.5" fill={my_vote === 'down' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {downvotes}
      </button>
    </div>
  )
}

function CandidateCard({
  candidate,
  rank,
  onVote,
  voteLoading,
}: {
  candidate: ShareCandidateOut
  rank: number
  onVote: (evalId: number, vote: 'up' | 'down' | 'clear') => void
  voteLoading: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const scoreColor = candidate.total_score >= 75 ? '#1D9E75' : candidate.total_score >= 50 ? '#EF9F27' : '#E24B4A'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:shadow-md">
      <div className="p-5 flex items-start gap-4">
        {/* Rank */}
        <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-black text-white" style={{ background: scoreColor }}>
          {rank}
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 text-base truncate">{candidate.candidate_name}</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {candidate.current_title}
                {candidate.years_experience != null && (
                  <span className="text-gray-400 ml-2">· {candidate.years_experience.toFixed(1)}y exp</span>
                )}
                {candidate.location && (
                  <span className="text-gray-400 ml-2">· {candidate.location}</span>
                )}
              </p>
            </div>
            <ScoreGauge score={candidate.total_score} />
          </div>

          {/* Score breakdown */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <ScoreBar label="Projects" value={candidate.project_score} color="#534AB7" />
            <ScoreBar label="Skills" value={candidate.skill_score} color="#1D9E75" />
            <ScoreBar label="Education" value={candidate.education_score} color="#EF9F27" />
          </div>

          {/* Skills */}
          {candidate.matched_skill_names.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {candidate.matched_skill_names.map((s) => (
                <span key={s} className="text-[11px] px-2 py-0.5 rounded-full bg-accent-100 text-accent font-medium">
                  {s}
                </span>
              ))}
              <span className="text-[11px] text-gray-400">
                {candidate.skills_matched}/{candidate.skills_total} skills
              </span>
            </div>
          )}

          {/* AI Summary preview */}
          {candidate.reasoning_summary && (
            <div className="mt-2">
              <p className={`text-xs text-gray-600 leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
                {candidate.reasoning_summary}
              </p>
              {candidate.reasoning_summary.length > 180 && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="text-xs text-accent mt-0.5 hover:underline"
                >
                  {expanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 pb-4 flex items-center justify-between border-t border-gray-100 pt-3">
        <VoteButtons candidate={candidate} onVote={onVote} loading={voteLoading} />
        {candidate.status && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold capitalize border ${
            candidate.status === 'shortlisted' || candidate.status === 'hired' || candidate.status === 'offer'
              ? 'bg-success-100 text-success-800 border-success-300'
              : candidate.status === 'rejected'
              ? 'bg-danger-100 text-danger-800 border-danger/40'
              : candidate.status === 'interview' || candidate.status === 'coding' || candidate.status === 'screening'
              ? 'bg-accent-100 text-accent-700 border-accent-300'
              : 'bg-gray-100 text-gray-500 border-gray-200'
          }`}>
            {candidate.status}
          </span>
        )}
      </div>
    </div>
  )
}

export default function ShareView() {
  const { token } = useParams<{ token: string }>()
  const queryClient = useQueryClient()
  const showToast = useAppStore((s) => s.showToast)
  const [voterToken] = useState(getVoterToken)
  const [voteLoadingId, setVoteLoadingId] = useState<number | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['share-view', token, voterToken],
    queryFn: () => getShareView(token!, voterToken),
    enabled: !!token,
    staleTime: 30_000,
  })

  const voteMut = useMutation({
    mutationFn: ({ evalId, vote }: { evalId: number; vote: 'up' | 'down' | 'clear' }) =>
      submitShareVote(token!, { evaluation_id: evalId, vote, voter_token: voterToken }),
    onMutate: ({ evalId }) => setVoteLoadingId(evalId),
    onError: () => showToast('Vote failed to save. Please try again.', 'error'),
    onSettled: () => {
      setVoteLoadingId(null)
      queryClient.invalidateQueries({ queryKey: ['share-view', token] })
    },
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <svg className="animate-spin w-8 h-8" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Loading candidate review…</span>
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold text-gray-700">Link not found or expired</p>
          <p className="text-sm text-gray-400">Please ask the recruiter to share a new link.</p>
        </div>
      </div>
    )
  }

  const sorted = [...data.candidates].sort((a, b) => b.total_score - a.total_score)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-black text-gray-900">Candidate Review</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              <span className="font-semibold text-accent">{data.job_role_title}</span>
              {data.label && <span className="ml-2 text-gray-400">· {data.label}</span>}
            </p>
          </div>
          <div className="text-right text-xs text-gray-400">
            {data.recipient_name && (
              <p className="font-medium text-gray-600">For: {data.recipient_name}</p>
            )}
            <p>{sorted.length} candidates</p>
            {data.expires_at && (
              <p>Expires {new Date(data.expires_at).toLocaleDateString()}</p>
            )}
          </div>
        </div>
      </div>

      {/* Vote summary bar */}
      {sorted.some((c) => c.upvotes + c.downvotes > 0) && (
        <div className="bg-accent-100/40 border-b border-accent-300/30">
          <div className="max-w-4xl mx-auto px-4 py-2 flex items-center gap-4 text-xs text-gray-500">
            <span className="font-semibold text-accent">Team feedback recorded</span>
            <span>{sorted.reduce((n, c) => n + c.upvotes, 0)} upvotes</span>
            <span>{sorted.reduce((n, c) => n + c.downvotes, 0)} downvotes</span>
          </div>
        </div>
      )}

      {/* Candidate cards */}
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {sorted.map((c, i) => (
          <CandidateCard
            key={c.evaluation_id}
            candidate={c}
            rank={i + 1}
            onVote={(evalId, vote) => voteMut.mutate({ evalId, vote })}
            voteLoading={voteLoadingId === c.evaluation_id}
          />
        ))}
      </div>

      <div className="max-w-4xl mx-auto px-4 pb-8 text-center text-xs text-gray-300">
        Powered by Tektalis ResumeEvals · Read-only view
      </div>
    </div>
  )
}
