import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createShareLink, listShareLinks, deactivateShareLink } from '../../api/client'
import type { JobRole } from '../../api/client'
import { useEscapeKey } from '../../lib/hooks'

interface Props {
  selectedRole: JobRole | null
  selectedIds: Set<number>       // evaluation IDs selected in the leaderboard
  onClose: () => void
}

const AVAILABLE_STAGES = [
  { key: 'applied', label: 'Applied', color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border-gray-300' },
  { key: 'screening', label: 'Screening', color: 'bg-accent-100 text-accent-700 border-accent-300' },
  { key: 'coding', label: 'Coding Test', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'interview', label: 'Interview', color: 'bg-warning-100 text-warning-800 border-warning' },
  { key: 'offer', label: 'Offer', color: 'bg-teal-50 text-teal-700 border-teal-200' },
  { key: 'hired', label: 'Hired', color: 'bg-success-100 text-success-800 border-success-300' },
  { key: 'rejected', label: 'Rejected', color: 'bg-danger-100 text-danger-800 border-danger' },
]

function LinkRow({ link, onDeactivate }: { link: any; onDeactivate: (id: number) => void }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/share/${link.token}`

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Determine filtering description
  let typeDesc = 'All candidates'
  if (link.stages && link.stages.length > 0) {
    typeDesc = `Stages: ${link.stages.map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')}`
  } else if (link.evaluation_ids) {
    try {
      const ids = typeof link.evaluation_ids === 'string'
        ? JSON.parse(link.evaluation_ids)
        : link.evaluation_ids
      const count = (ids || []).length
      typeDesc = `Static snapshot (${count} candidate${count !== 1 ? 's' : ''})`
    } catch {
      typeDesc = 'Static snapshot'
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
          {link.label || `Share Link #${link.id}`}
        </p>
        {link.recipient_name && (
          <p className="text-xs text-gray-500 dark:text-gray-400">For: {link.recipient_name}</p>
        )}
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
          {link.candidate_count} candidates · {typeDesc}
        </p>
        {link.expires_at && (
          <p className="text-[10px] text-gray-400 mt-0.5">
            Expires {new Date(link.expires_at).toLocaleDateString()}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        <button
          onClick={copy}
          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all flex items-center gap-1 ${
            copied
              ? 'bg-success-100 text-success-800 border-success-300'
              : 'bg-white dark:bg-gray-700 text-accent border-accent/40 hover:bg-accent-100'
          }`}
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              Copy Link
            </>
          )}
        </button>
        <button
          onClick={() => onDeactivate(link.id)}
          className="text-xs p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-danger-100 transition-colors"
          title="Deactivate link"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default function ShareLinksModal({ selectedRole, selectedIds, onClose }: Props) {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState<number | ''>(30)
  
  const [shareMode, setShareMode] = useState<'all' | 'selected' | 'stages'>(
    selectedIds.size > 0 ? 'selected' : 'all'
  )
  const [selectedStages, setSelectedStages] = useState<string[]>([])

  const { data: links = [], isLoading, isError } = useQuery({
    queryKey: ['share-links', selectedRole?.id],
    queryFn: () => listShareLinks(selectedRole?.id ?? undefined),
    enabled: !!selectedRole,
  })

  useEscapeKey(onClose, true)

  const createMut = useMutation({
    mutationFn: () =>
      createShareLink({
        job_role_id: selectedRole!.id,
        evaluation_ids: shareMode === 'selected' && selectedIds.size > 0 ? [...selectedIds] : undefined,
        stages: shareMode === 'stages' && selectedStages.length > 0 ? selectedStages : undefined,
        label: label.trim() || undefined,
        recipient_name: recipientName.trim() || undefined,
        expires_in_days: expiresInDays === '' ? undefined : Number(expiresInDays),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['share-links'] })
      setLabel('')
      setRecipientName('')
      setSelectedStages([])
    },
  })

  const deactivateMut = useMutation({
    mutationFn: deactivateShareLink,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['share-links'] }),
  })

  const activeLinks = links.filter((l: any) => l.is_active)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fadeIn">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden border border-gray-100 dark:border-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Share Candidates</h2>
            <p className="text-xs text-gray-400 mt-0.5">Create read-only links for hiring managers</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Create form */}
        <div className="px-5 py-4 space-y-3.5 border-b border-gray-100 dark:border-gray-800 shrink-0 overflow-y-auto max-h-[50vh]">
          {/* Share Method Selection */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Share Method</p>
            <div className="flex gap-2 p-1 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200/60 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setShareMode('all')}
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-lg transition-all ${
                  shareMode === 'all'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-150'
                }`}
              >
                All Candidates
              </button>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setShareMode('selected')}
                  className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-lg transition-all ${
                    shareMode === 'selected'
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-150'
                  }`}
                >
                  Selected ({selectedIds.size})
                </button>
              )}
              <button
                type="button"
                onClick={() => setShareMode('stages')}
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-lg transition-all ${
                  shareMode === 'stages'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-150'
                }`}
              >
                Filter by Stages
              </button>
            </div>
          </div>

          {/* Dynamic Stages Selection */}
          {shareMode === 'stages' && (
            <div className="space-y-1.5 animate-fadeIn">
              <label className="text-[11px] text-gray-500 dark:text-gray-400 block font-semibold">
                Include Candidate Stages (select one or more):
              </label>
              <div className="flex flex-wrap gap-2 p-2.5 bg-gray-50 dark:bg-gray-800/40 rounded-xl border border-gray-200 dark:border-gray-700">
                {AVAILABLE_STAGES.map((st) => {
                  const isChecked = selectedStages.includes(st.key)
                  return (
                    <button
                      key={st.key}
                      type="button"
                      onClick={() => {
                        setSelectedStages((prev) =>
                          isChecked ? prev.filter((k) => k !== st.key) : [...prev, st.key]
                        )
                      }}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all font-semibold flex items-center gap-1.5 ${
                        isChecked
                          ? `${st.color} border-current ring-1 ring-current shadow-sm`
                          : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${isChecked ? 'bg-current animate-pulse' : 'bg-gray-300 dark:bg-gray-500'}`} />
                      {st.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-gray-500 dark:text-gray-400 block mb-1">Label (optional)</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. CTO Review"
                className="w-full text-sm border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 dark:text-gray-400 block mb-1">Recipient (optional)</label>
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="e.g. John (CTO)"
                className="w-full text-sm border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[11px] text-gray-500 dark:text-gray-400 block mb-1">Expires in (days)</label>
              <input
                type="number"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="30"
                min={1}
                className="w-full text-sm border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <button
              onClick={() => createMut.mutate()}
              disabled={!selectedRole || createMut.isPending || (shareMode === 'stages' && selectedStages.length === 0)}
              className="mt-4 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-700 disabled:opacity-50 transition-colors"
            >
              {createMut.isPending ? 'Creating…' : 'Create Link'}
            </button>
          </div>
          {createMut.isSuccess && (
            <p className="text-xs text-success font-semibold">Link created — copy it below.</p>
          )}
        </div>

        {/* Existing links */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {isLoading ? (
            <p className="text-sm text-gray-400 text-center py-4">Loading links…</p>
          ) : isError ? (
            <p className="text-sm text-danger text-center py-4">Failed to load share links.</p>
          ) : activeLinks.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No active share links for this role.</p>
          ) : (
            <>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Active Links</p>
              {activeLinks.map((link: any) => (
                <LinkRow key={link.id} link={link} onDeactivate={(id) => deactivateMut.mutate(id)} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
