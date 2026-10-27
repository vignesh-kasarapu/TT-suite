import { useState, useMemo, useEffect } from 'react'
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd'
import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { getResults, updateEvaluationStage, bulkUpdateStage, getJobRoles } from '../api/client'
import type { CandidateResult, CandidateStage, JobRole } from '../api/client'
import { useAppStore } from '../store/useAppStore'
import StatusBadge from '../components/StatusBadge'

const STAGES: { key: CandidateStage; label: string; color: string; border: string; bg: string }[] = [
  { key: 'applied',    label: 'Applied',      color: 'text-gray-600 dark:text-gray-300',    border: 'border-gray-300 dark:border-gray-600',   bg: 'bg-gray-50 dark:bg-gray-900' },
  { key: 'screening',  label: 'Screening',    color: 'text-accent-700 dark:text-accent-300', border: 'border-accent-300',                       bg: 'bg-accent-100/30 dark:bg-accent-900/30' },
  { key: 'coding',     label: 'Coding Test',  color: 'text-blue-700 dark:text-blue-300',    border: 'border-blue-300 dark:border-blue-600',   bg: 'bg-blue-50/40 dark:bg-blue-950/20' },
  { key: 'interview',  label: 'Interview',    color: 'text-warning-800',                      border: 'border-warning',                       bg: 'bg-warning-100/40' },
  { key: 'offer',      label: 'Offer',        color: 'text-teal-700 dark:text-teal-300',    border: 'border-teal-400 dark:border-teal-600',   bg: 'bg-teal-50/40 dark:bg-teal-950/20' },
  { key: 'hired',      label: 'Hired',        color: 'text-success-800',                      border: 'border-success-300',                       bg: 'bg-success-100/40' },
  { key: 'rejected',   label: 'Rejected',     color: 'text-danger-800',                      border: 'border-danger/50',                    bg: 'bg-danger-100/30' },
]

const STAGE_BADGE: Record<string, string> = {
  applied:   'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  screening: 'bg-accent-100 text-accent-700',
  coding:    'bg-blue-100 text-blue-700',
  interview: 'bg-warning-100 text-warning-800',
  offer:     'bg-teal-100 text-teal-700',
  hired:     'bg-success-100 text-success-800',
  rejected:  'bg-danger-100 text-danger-800',
}

function ScoreDot({ score }: { score: number }) {
  const color = score >= 75 ? '#1D9E75' : score >= 50 ? '#EF9F27' : '#E24B4A'
  return (
    <span
      className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded-full"
      style={{ color, background: color + '18' }}
    >
      {Math.round(score)}
    </span>
  )
}

function CandidateCard({
  item,
  index,
  batchMode,
  selected,
  onToggleSelect,
}: {
  item: CandidateResult
  index: number
  batchMode: boolean
  selected: boolean
  onToggleSelect: (candidateId: number) => void
}) {
  return (
    <Draggable draggableId={String(item.candidate_id)} index={index} isDragDisabled={batchMode}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={batchMode ? () => onToggleSelect(item.candidate_id) : undefined}
          className={`bg-white dark:bg-gray-800 border rounded-xl p-3 space-y-2 shadow-sm select-none transition-shadow ${
            batchMode ? 'cursor-pointer' : ''
          } ${
            selected
              ? 'border-accent ring-2 ring-accent/30'
              : 'border-gray-200 dark:border-gray-700'
          } ${
            snapshot.isDragging ? 'shadow-xl ring-2 ring-accent/30 rotate-1' : 'hover:shadow-md'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            {batchMode && (
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(item.candidate_id)}
                onClick={(e) => e.stopPropagation()}
                className="w-3.5 h-3.5 mt-0.5 text-accent border-gray-300 dark:border-gray-700 dark:bg-gray-800 rounded focus:ring-accent cursor-pointer shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate leading-tight">
                {item.candidate_name}
              </p>
              {item.candidate_current_title && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                  {item.candidate_current_title}
                </p>
              )}
            </div>
            <ScoreDot score={item.total_score} />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusBadge status={item.status} />
            {item.candidate_experience_level && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 capitalize">
                {item.candidate_experience_level}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
            <span>{item.skills_matched}/{item.skills_total} skills</span>
            {item.candidate_location && (
              <span className="truncate max-w-[80px]" title={item.candidate_location}>
                {item.candidate_location}
              </span>
            )}
          </div>

          {item.matched_skill_names?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.matched_skill_names.slice(0, 3).map((s) => (
                <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-100 dark:bg-accent-900 text-accent dark:text-accent-300 font-medium">
                  {s}
                </span>
              ))}
              {item.matched_skill_names.length > 3 && (
                <span className="text-[10px] text-gray-400">+{item.matched_skill_names.length - 3}</span>
              )}
            </div>
          )}
        </div>
      )}
    </Draggable>
  )
}

function KanbanSkeleton() {
  return (
    <div className="flex flex-col h-full animate-pulse">
      {/* Header Skeleton */}
      <div className="px-4 pt-4 pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-36 mb-2" />
          <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-48" />
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-64" />
          <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-32" />
        </div>
      </div>

      {/* Columns Skeleton */}
      <div className="flex gap-3 overflow-x-auto px-4 pb-4 pt-1 flex-1 min-h-0">
        {STAGES.map((stage) => (
          <div
            key={stage.key}
            className={`flex flex-col rounded-xl border ${stage.border} ${stage.bg} min-w-[220px] w-[220px] shrink-0 overflow-hidden opacity-60`}
          >
            <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className={`text-xs font-bold uppercase tracking-wide ${stage.color}`}>
                {stage.label}
              </span>
              <span className="w-5 h-4 bg-gray-200 dark:bg-gray-700 rounded-full" />
            </div>

            <div className="flex-1 p-2 space-y-2">
              {Array.from({ length: stage.key === 'applied' ? 2 : stage.key === 'screening' ? 1 : 0 }).map((_, cIdx) => (
                <div key={cIdx} className="bg-white dark:bg-gray-850 border border-gray-100 dark:border-gray-800 rounded-xl p-3 space-y-2.5 shadow-sm">
                  <div className="flex justify-between items-start gap-2">
                    <div className="space-y-1.5 flex-1">
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                      <div className="h-2 bg-gray-150 dark:bg-gray-700 rounded w-1/2" />
                    </div>
                    <div className="w-7 h-4 bg-gray-200 dark:bg-gray-700 rounded-full shrink-0" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-14" />
                    <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-12" />
                  </div>
                  <div className="flex justify-between items-center pt-1">
                    <div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded w-16" />
                    <div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded w-10" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function KanbanBoard() {
  const selectedJobRoleId = useAppStore((s) => s.selectedJobRoleId)
  const showToast = useAppStore((s) => s.showToast)
  const queryClient = useQueryClient()
  const [localStages, setLocalStages] = useState<Record<number, CandidateStage>>({})
  const [batchMode, setBatchMode] = useState(false)
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<number>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (debounceTimer) clearTimeout(debounceTimer)
    const t = setTimeout(() => {
      setDebouncedSearchQuery(value)
    }, 350)
    setDebounceTimer(t)
  }

  useEffect(() => {
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [debounceTimer])

  const { data: jobRoles } = useQuery({ queryKey: ['job-roles'], queryFn: getJobRoles })
  const selectedRole: JobRole | null = jobRoles?.find((r: JobRole) => r.id === selectedJobRoleId) ?? null

  const { data, isLoading, isFetching, isError, refetch } = useInfiniteQuery({
    queryKey: ['kanban-results', selectedJobRoleId, debouncedSearchQuery],
    queryFn: ({ pageParam = 1 }) =>
      getResults({
        job_role_id: selectedJobRoleId ?? undefined,
        sort: 'total_score',
        order: 'desc',
        limit: 200,
        page: pageParam as number,
        search: debouncedSearchQuery || undefined,
      }),
    getNextPageParam: (lastPage, allPages) => {
      const count = allPages.reduce((n, p) => n + p.items.length, 0)
      return count < lastPage.total ? allPages.length + 1 : undefined
    },
    initialPageParam: 1,
    staleTime: 0,
  })

  const stageMut = useMutation({
    mutationFn: ({ evaluationId, stage }: { candidateId: number; evaluationId: number; stage: CandidateStage }) =>
      updateEvaluationStage(evaluationId, stage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban-results'] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
    },
    onError: (err: any, { candidateId }) => {
      // Revert the optimistic column move — the card would otherwise sit in
      // the dropped column indefinitely even though the save failed (e.g.
      // the candidate was deleted concurrently, or the stage is stale/invalid).
      setLocalStages((prev) => {
        const next = { ...prev }
        delete next[candidateId]
        return next
      })
      showToast(err?.response?.data?.detail ?? 'Failed to move candidate. Please try again.', 'error')
    },
  })

  const bulkStageMut = useMutation({
    mutationFn: ({ evaluationIds, stage }: { evaluationIds: number[]; stage: CandidateStage }) =>
      bulkUpdateStage(evaluationIds, stage),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['kanban-results'] })
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setSelectedCandidateIds(new Set())
      showToast(`${res.updated} candidate(s) moved.`, 'success')
    },
    onError: () => showToast('Bulk move failed. Please try again.', 'error'),
  })

  function toggleCandidateSelect(candidateId: number) {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev)
      next.has(candidateId) ? next.delete(candidateId) : next.add(candidateId)
      return next
    })
  }

  const allItems = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])

  const columns = useMemo(() => {
    const map: Record<CandidateStage, CandidateResult[]> = {
      applied: [], screening: [], coding: [], interview: [], offer: [], hired: [], rejected: [],
    }
    for (const item of allItems) {
      const stage = (localStages[item.candidate_id] ?? item.candidate_stage) as CandidateStage
      if (map[stage]) map[stage].push(item)
    }
    return map
  }, [allItems, localStages])

  function onDragEnd(result: DropResult) {
    const { destination, draggableId } = result
    if (!destination) return
    const candidateId = Number(draggableId)
    const newStage = destination.droppableId as CandidateStage
    const item = allItems.find((r) => r.candidate_id === candidateId)
    if (!item) return
    const currentStage = localStages[candidateId] ?? item.candidate_stage
    if (currentStage === newStage) return

    setLocalStages((prev) => ({ ...prev, [candidateId]: newStage }))
    stageMut.mutate({ candidateId, evaluationId: item.evaluation_id, stage: newStage })
  }

  if (isLoading) {
    return <KanbanSkeleton />
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
        <p className="text-sm text-danger-800 dark:text-red-300 font-medium">Failed to load the pipeline.</p>
        <button
          onClick={() => refetch()}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            Hiring Pipeline
            {isFetching && !isLoading && (
              <svg className="animate-spin h-4 w-4 text-accent dark:text-accent-300" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
          </h1>
          {selectedRole && (
            <p className="text-sm text-gray-500 dark:text-gray-400">{selectedRole.title}</p>
          )}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {/* Search Box */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg pl-9 pr-8 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition placeholder-gray-400 dark:placeholder-gray-500 w-64"
            />
            {searchQuery && (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm leading-none"
              >
                &times;
              </button>
            )}
          </div>

          <button
            onClick={() => {
              setBatchMode((v) => !v)
              setSelectedCandidateIds(new Set())
            }}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
              batchMode
                ? 'bg-accent text-white border-accent'
                : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-accent'
            }`}
          >
            {batchMode ? 'Exit Batch Select' : 'Batch Select'}
          </button>

          {!batchMode && (
            <div className="text-xs text-gray-400 flex items-center gap-1.5 select-none">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              Drag cards to move candidates between stages
            </div>
          )}
        </div>
      </div>

      {batchMode && selectedCandidateIds.size > 0 && (
        <div className="mx-4 mb-2 flex items-center gap-3 bg-accent-100 dark:bg-accent-900 border border-accent-300 rounded-xl px-4 py-2.5 shrink-0">
          <span className="text-sm font-semibold text-accent-700 dark:text-accent-300">
            {selectedCandidateIds.size} selected
          </span>
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return
              const evaluationIds = allItems
                .filter((it) => selectedCandidateIds.has(it.candidate_id))
                .map((it) => it.evaluation_id)
              bulkStageMut.mutate({ evaluationIds, stage: e.target.value as CandidateStage })
            }}
            disabled={bulkStageMut.isPending}
            className="text-xs font-semibold px-2 py-1.5 rounded-lg bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:border-accent disabled:opacity-50 transition-colors"
          >
            <option value="">Move to stage…</option>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={() => setSelectedCandidateIds(new Set())}
            className="ml-auto text-xs text-accent dark:text-accent-300 hover:underline"
          >
            Clear selection
          </button>
        </div>
      )}

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto px-4 pb-4 pt-1 flex-1 min-h-0">
          {STAGES.map((stage) => {
            const cards = columns[stage.key] ?? []
            return (
              <div
                key={stage.key}
                className={`flex flex-col rounded-xl border ${stage.border} ${stage.bg} min-w-[220px] w-[220px] shrink-0 overflow-hidden`}
              >
                <div className={`px-3 py-2.5 border-b ${stage.border} flex items-center justify-between`}>
                  <span className={`text-xs font-bold uppercase tracking-wide ${stage.color}`}>
                    {stage.label}
                  </span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STAGE_BADGE[stage.key]}`}>
                    {cards.length}
                  </span>
                </div>

                <Droppable droppableId={stage.key}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 overflow-y-auto p-2 space-y-2 transition-colors ${
                        snapshot.isDraggingOver ? 'bg-accent/5 dark:bg-accent/10' : ''
                      }`}
                      style={{ minHeight: 80 }}
                    >
                      {cards.map((item, i) => (
                        <CandidateCard
                          key={item.candidate_id}
                          item={item}
                          index={i}
                          batchMode={batchMode}
                          selected={selectedCandidateIds.has(item.candidate_id)}
                          onToggleSelect={toggleCandidateSelect}
                        />
                      ))}
                      {provided.placeholder}
                      {cards.length === 0 && !snapshot.isDraggingOver && (
                        <p className="text-[11px] text-center text-gray-400 dark:text-gray-600 py-4">
                          Drop here
                        </p>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            )
          })}
        </div>
      </DragDropContext>
    </div>
  )
}
