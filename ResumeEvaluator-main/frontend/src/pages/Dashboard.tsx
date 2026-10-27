import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getJobRoles, getResultsSummary, getAnalytics, deleteJobRole, archiveJobRole } from '../api/client'
import type { JobRole } from '../api/client'
import { useAppStore } from '../store/useAppStore'
import { motion } from 'framer-motion'
import { Plus, Upload, Trophy, BarChart3, Search, AlertTriangle, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import { useConfirm } from '../components/shared/ConfirmDialog'

function StatCard({ label, value, sub, color, onClick }: {
  label: string
  value: number | string
  sub?: string
  color?: string
  onClick?: () => void
}) {
  return (
    <motion.button
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      disabled={!onClick}
      className="glass-card rounded-xl p-4 text-left hover:border-white/60 hover:shadow-xl transition-all duration-300 disabled:cursor-default w-full"
    >
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p
        className={`text-2xl font-black tabular-nums ${!color ? 'text-gray-900 dark:text-gray-100' : ''}`}
        style={color ? { color } : undefined}
      >{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </motion.button>
  )
}

function RolePipelineCard({ role, onSelect }: { role: JobRole; onSelect: () => void }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { data: summary } = useQuery({
    queryKey: ['results-summary', role.id],
    queryFn: () => getResultsSummary(role.id),
    staleTime: 10_000,
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteJobRole(role.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['job-roles'] }),
  })

  const archiveMut = useMutation({
    mutationFn: (archived: boolean) => archiveJobRole(role.id, archived),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['job-roles'] }),
  })

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (await confirm({
      title: 'Delete Job Role?',
      description: 'Are you sure you want to delete this job role? This will permanently delete all associated evaluations, candidate applications, and bookmarks.',
      intent: 'danger',
    })) {
      deleteMut.mutate()
    }
  }

  async function handleArchive(e: React.MouseEvent) {
    e.stopPropagation()
    if (role.is_archived) {
      archiveMut.mutate(false)
      return
    }
    if (await confirm({
      title: 'Archive Job Role?',
      description: 'Archive this job role? It will be hidden from the candidate portal, but evaluations and candidate data are kept. You can unarchive it anytime.',
      intent: 'warning',
    })) {
      archiveMut.mutate(true)
    }
  }

  const active = !role.intake_paused && !role.is_archived
  const total = summary?.total ?? 0
  const shortlisted = summary?.shortlisted ?? 0
  const review = summary?.needs_review ?? 0
  const pending = summary?.pending ?? 0

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="glass-card rounded-xl p-4 hover:border-white/60 hover:shadow-xl transition-all duration-300"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{role.title}</p>
          {role.department && (
            <span className="text-[10px] text-accent font-medium">{role.department}</span>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            role.is_archived
              ? 'bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600'
              : active ? 'bg-success-100 text-success-800 border-success-300' : 'bg-amber-50 text-amber-600 border-amber-200'
          }`}>
            {role.is_archived ? 'Archived' : active ? 'Live' : 'Paused'}
          </span>
          <button
            onClick={handleArchive}
            disabled={archiveMut.isPending}
            title={role.is_archived ? 'Unarchive job role' : 'Archive job role — hide from candidate portal'}
            className="p-1 text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded transition-colors disabled:opacity-50"
          >
            {role.is_archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteMut.isPending}
            title="Delete job role"
            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center">
          <p className="text-lg font-bold text-gray-800 dark:text-gray-100 tabular-nums">{total}</p>
          <p className="text-[10px] text-gray-400">Total</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold tabular-nums" style={{ color: '#1D9E75' }}>{shortlisted}</p>
          <p className="text-[10px] text-gray-400">Shortlisted</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold tabular-nums" style={{ color: review > 0 ? '#EF9F27' : '#9CA3AF' }}>{review}</p>
          <p className="text-[10px] text-gray-400">Review</p>
        </div>
      </div>

      {total > 0 && (
        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden flex">
          <div className="bg-success h-full transition-all" style={{ width: `${(shortlisted / total) * 100}%` }} />
          <div className="bg-warning h-full transition-all" style={{ width: `${(review / total) * 100}%` }} />
          <div className="bg-accent h-full transition-all" style={{ width: `${(pending / total) * 100}%` }} />
        </div>
      )}

      <button
        onClick={onSelect}
        className="mt-3 w-full text-xs font-semibold text-accent dark:text-accent-300 hover:underline text-center"
      >
        View leaderboard →
      </button>
    </motion.div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { setJobRole } = useAppStore()

  const { data: jobRoles = [] } = useQuery<JobRole[]>({
    queryKey: ['job-roles'],
    queryFn: getJobRoles,
    staleTime: 30_000,
  })

  const { data: globalSummary, isLoading: summaryLoading, isError: summaryError } = useQuery({
    queryKey: ['results-summary-global'],
    queryFn: () => getResultsSummary(undefined),
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  const { data: analytics } = useQuery({
    queryKey: ['analytics-global-7d'],
    queryFn: () => getAnalytics(undefined, 7),
    staleTime: 30_000,
  })

  const visibleRoles = (jobRoles as JobRole[]).filter((r) => !r.is_archived)
  const activeRoles = visibleRoles.filter((r) => !r.intake_paused)
  const pausedRoles = visibleRoles.filter((r) => r.intake_paused)
  const archivedRoles = (jobRoles as JobRole[]).filter((r) => r.is_archived)

  function selectRole(roleId: number) {
    setJobRole(roleId)
    navigate('/leaderboard')
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            {activeRoles.length} active role{activeRoles.length !== 1 ? 's' : ''} · {pausedRoles.length} paused
            {archivedRoles.length > 0 ? ` · ${archivedRoles.length} archived` : ''}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/jobs/new')}
          className="flex items-center gap-1.5 text-sm font-semibold text-white bg-gradient-to-r from-accent to-accent-700 hover:from-[#433A9D] hover:to-[#2A2367] px-4 py-2 rounded-xl shadow-lg hover:shadow-xl transition-all"
        >
          <Plus className="w-4 h-4" />
          Post a Job
        </motion.button>
      </div>

      {/* Global KPI strip */}
      {summaryError ? (
        <div className="glass-card !bg-red-500/10 dark:!bg-red-500/20 !border-red-500/30 rounded-xl px-4 py-3 text-sm text-danger-800 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Could not load summary stats — the backend may need a restart to apply recent database changes.
        </div>
      ) : summaryLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-card rounded-xl p-4 space-y-2">
              <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded w-24" />
              <div className="h-7 bg-gray-100 dark:bg-gray-800 rounded w-16" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Total Evaluated"
            value={globalSummary?.total ?? 0}
            sub="across all roles"
            onClick={() => navigate('/leaderboard')}
          />
          <StatCard
            label="Shortlisted"
            value={globalSummary?.shortlisted ?? 0}
            sub="ready to advance"
            color="var(--color-success)"
            onClick={() => navigate('/leaderboard')}
          />
          <StatCard
            label="Needs Review"
            value={globalSummary?.needs_review ?? 0}
            sub="pending decision"
            color="var(--color-warning)"
            onClick={() => navigate('/leaderboard')}
          />
          <StatCard
            label="Avg Fit Score"
            value={analytics ? `${Math.round(analytics.avg_score)}` : '—'}
            sub="across all roles (7d)"
            color="var(--color-accent)"
          />
        </div>
      )}

      {/* Active roles pipeline */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Active Roles
          </h2>
          <button onClick={() => navigate('/configure')} className="text-xs text-accent hover:underline">
            Manage →
          </button>
        </div>

        {jobRoles.length === 0 ? (
          <div className="glass-card rounded-xl border-2 border-dashed !border-gray-400/30 p-8 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">No job roles yet.</p>
            <button
              onClick={() => navigate('/jobs/new')}
              className="mt-3 text-sm text-accent hover:underline font-medium"
            >
              Create your first job →
            </button>
          </div>
        ) : visibleRoles.length === 0 ? (
          <div className="glass-card rounded-xl border-2 border-dashed !border-gray-400/30 p-8 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">All job roles are archived.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleRoles.map((role) => (
              <RolePipelineCard
                key={role.id}
                role={role}
                onSelect={() => selectRole(role.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Archived roles */}
      {archivedRoles.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3">
            Archived Roles ({archivedRoles.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 opacity-70">
            {archivedRoles.map((role) => (
              <RolePipelineCard
                key={role.id}
                role={role}
                onSelect={() => selectRole(role.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Upload Resumes', icon: Upload, path: '/upload' },
            { label: 'View Leaderboard', icon: Trophy, path: '/leaderboard' },
            { label: 'Analytics', icon: BarChart3, path: '/analytics' },
            { label: 'Search Candidates', icon: Search, path: '/search' },
          ].map(({ label, icon: Icon, path }) => (
            <motion.button
              whileHover={{ y: -2, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              key={path}
              onClick={() => navigate(path)}
              className="flex flex-col items-center gap-2 p-4 glass-card rounded-xl hover:border-white/60 hover:bg-white/40 dark:hover:bg-gray-800/80 transition-all text-center"
            >
              <Icon className="w-6 h-6 text-accent dark:text-accent-300" />
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{label}</span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  )
}
