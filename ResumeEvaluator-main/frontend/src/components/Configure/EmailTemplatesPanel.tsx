import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useConfirm } from '../shared/ConfirmDialog'
import {
  getEmailTemplates,
  getEmployeeEmails,
  updateEmailTemplate,
  resetEmailTemplate,
  deleteEmailTemplate,
  EMAIL_TEMPLATE_LABELS,
} from '../../api/client'
import type { EmailTemplate, EmployeeEmail } from '../../api/client'
import RecipientInput from '../shared/RecipientInput'

const inputCls =
  'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40'

const BUILTIN_KEYS = new Set(Object.keys(EMAIL_TEMPLATE_LABELS))

function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map((e) => e.trim()).filter(Boolean)
}


// ── Main panel ────────────────────────────────────────────────────────────────
export default function EmailTemplatesPanel() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  // Selected template
  const [tplKey, setTplKey] = useState('next_steps')
  const [tplSubject, setTplSubject] = useState('')
  const [tplBody, setTplBody] = useState('')
  const [tplCc, setTplCc] = useState<string[]>([])
  const [tplBcc, setTplBcc] = useState<string[]>([])
  const [tplSaveMsg, setTplSaveMsg] = useState<string | null>(null)

  // New custom template form
  const [showNewForm, setShowNewForm] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newSubject, setNewSubject] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newCc, setNewCc] = useState<string[]>([])
  const [newBcc, setNewBcc] = useState<string[]>([])
  const [newMsg, setNewMsg] = useState<string | null>(null)

  const { data: emailTemplates, isLoading: templatesLoading, isError: templatesError, refetch: refetchTemplates } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: getEmailTemplates,
  })

  const { data: employeeEmails = [] } = useQuery<EmployeeEmail[]>({
    queryKey: ['employeeEmails'],
    queryFn: getEmployeeEmails,
  })

  const currentTpl: EmailTemplate | undefined = emailTemplates?.find(
    (t: EmailTemplate) => t.key === tplKey,
  )

  useEffect(() => {
    if (!currentTpl) return
    setTplSubject(currentTpl.subject)
    setTplBody(currentTpl.body_text)
    setTplCc(parseEmailList(currentTpl.cc))
    setTplBcc(parseEmailList(currentTpl.bcc))
  }, [tplKey, currentTpl?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveTplMut = useMutation({
    mutationFn: () =>
      updateEmailTemplate(tplKey, tplSubject, tplBody, {
        cc: tplCc.length ? tplCc.join(',') : null,
        bcc: tplBcc.length ? tplBcc.join(',') : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailTemplates'] })
      setTplSaveMsg('Saved ✓')
      setTimeout(() => setTplSaveMsg(null), 2500)
    },
  })

  const resetTplMut = useMutation({
    mutationFn: () => resetEmailTemplate(tplKey),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['emailTemplates'] })
      setTplSubject(data.subject)
      setTplBody(data.body_text)
      setTplCc(parseEmailList(data.cc))
      setTplBcc(parseEmailList(data.bcc))
      setTplSaveMsg('Reset to default')
      setTimeout(() => setTplSaveMsg(null), 2500)
    },
  })

  const deleteTplMut = useMutation({
    mutationFn: (key: string) => deleteEmailTemplate(key),
    onSuccess: (_data, key) => {
      queryClient.invalidateQueries({ queryKey: ['emailTemplates'] })
      if (tplKey === key) setTplKey(Object.keys(EMAIL_TEMPLATE_LABELS)[0])
      setTplSaveMsg('Template deleted')
      setTimeout(() => setTplSaveMsg(null), 2500)
    },
  })

  const createTplMut = useMutation({
    mutationFn: () => {
      const slug = newKey
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
      return updateEmailTemplate(slug, newSubject.trim(), newBody.trim(), {
        cc: newCc.length ? newCc.join(',') : null,
        bcc: newBcc.length ? newBcc.join(',') : null,
      })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['emailTemplates'] })
      setTplKey(data.key)
      setShowNewForm(false)
      setNewKey(''); setNewSubject(''); setNewBody(''); setNewCc([]); setNewBcc([])
      setNewMsg('Custom template created')
      setTimeout(() => setNewMsg(null), 2500)
    },
    onError: (err: any) => {
      setNewMsg(err?.response?.data?.detail ?? 'Failed to create template')
    },
  })

  const isBuiltin = BUILTIN_KEYS.has(tplKey)

  return (
    <div className="glass-card rounded-xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">Email Templates</h2>
        <button
          onClick={() => setShowNewForm(!showNewForm)}
          className="text-xs font-medium text-accent border border-accent/40 hover:bg-accent-100 dark:hover:bg-accent-900 px-3 py-1.5 rounded-lg transition-colors"
        >
          {showNewForm ? 'Cancel' : '+ New Template'}
        </button>
      </div>

      {templatesLoading && (
        <p className="text-xs text-gray-400 dark:text-gray-500">Loading templates…</p>
      )}
      {templatesError && (
        <div className="flex items-center gap-3 bg-danger-100 dark:bg-red-900/20 border border-danger/40 rounded-lg px-3 py-2">
          <p className="text-xs text-danger-800 dark:text-red-300">Failed to load email templates.</p>
          <button
            onClick={() => refetchTemplates()}
            className="text-xs font-medium text-danger-800 dark:text-red-300 underline shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Customize candidate-facing emails. Placeholders:{' '}
        {['{candidate_name}', '{job_title}', '{score}', '{years_experience}'].map((p) => (
          <code key={p} className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded text-[11px] mr-1">
            {p}
          </code>
        ))}
      </p>

      {/* New template form */}
      {showNewForm && (
        <div className="glass-panel rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Create Custom Template</h3>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Template Name / Key</label>
            <input
              className={inputCls}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="e.g. offer_extended"
            />
            <p className="text-[11px] text-gray-400 mt-0.5">Spaces → underscores, lowercase only</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Subject</label>
            <input className={inputCls} value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Email subject…" />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Body</label>
            <textarea rows={4} className={`${inputCls} resize-y font-mono text-xs`} value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="Email body…" />
          </div>
          <RecipientInput
            label="CC (always added when this template is sent)"
            recipients={newCc}
            onAdd={(e) => setNewCc((prev) => [...prev, e])}
            onRemove={(e) => setNewCc((prev) => prev.filter((x) => x !== e))}
            suggestions={employeeEmails}
          />
          <RecipientInput
            label="BCC (always added when this template is sent)"
            recipients={newBcc}
            onAdd={(e) => setNewBcc((prev) => [...prev, e])}
            onRemove={(e) => setNewBcc((prev) => prev.filter((x) => x !== e))}
            suggestions={employeeEmails}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => createTplMut.mutate()}
              disabled={createTplMut.isPending || !newKey.trim() || !newSubject.trim() || !newBody.trim()}
              className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2 transition-colors"
            >
              {createTplMut.isPending ? 'Creating…' : 'Create Template'}
            </button>
            {newMsg && (
              <span className={`text-xs font-medium ${newMsg.includes('created') ? 'text-success' : 'text-red-500'}`}>
                {newMsg}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Template selector tabs */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(EMAIL_TEMPLATE_LABELS).map(([key, label]) => {
          const tpl = emailTemplates?.find((t: EmailTemplate) => t.key === key)
          const isModified = tpl?.updated_at != null
          return (
            <button
              key={key}
              onClick={() => setTplKey(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                tplKey === key
                  ? 'bg-accent text-white border-accent'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-accent'
              }`}
            >
              {label}
              {isModified && <span className="ml-1 text-[9px] opacity-70">●</span>}
            </button>
          )
        })}
        {emailTemplates
          ?.filter((t: EmailTemplate) => !BUILTIN_KEYS.has(t.key))
          .map((t: EmailTemplate) => (
            <button
              key={t.key}
              onClick={() => setTplKey(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1 ${
                tplKey === t.key
                  ? 'bg-accent text-white border-accent'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-accent'
              }`}
            >
              <span className="text-[9px] opacity-60">✦</span>
              {t.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </button>
          ))}
      </div>

      {/* ── Body / Subject editor ── */}
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Subject</label>
          <input
            className={inputCls}
            value={tplSubject}
            onChange={(e) => setTplSubject(e.target.value)}
            placeholder="Email subject…"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Body (plain text)</label>
          <textarea
            rows={8}
            className={`${inputCls} resize-y font-mono text-xs`}
            value={tplBody}
            onChange={(e) => setTplBody(e.target.value)}
            placeholder="Email body…"
          />
        </div>

        {/* CC / BCC for existing template */}
        <RecipientInput
          label="CC (always added when this template is sent)"
          recipients={tplCc}
          onAdd={(e) => setTplCc((prev) => [...prev, e])}
          onRemove={(e) => setTplCc((prev) => prev.filter((x) => x !== e))}
          suggestions={employeeEmails}
        />
        <RecipientInput
          label="BCC (always added when this template is sent)"
          recipients={tplBcc}
          onAdd={(e) => setTplBcc((prev) => [...prev, e])}
          onRemove={(e) => setTplBcc((prev) => prev.filter((x) => x !== e))}
          suggestions={employeeEmails}
        />
      </div>

      {/* ── Action buttons ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => saveTplMut.mutate()}
          disabled={saveTplMut.isPending || !tplSubject.trim() || !tplBody.trim()}
          className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          {saveTplMut.isPending ? 'Saving…' : 'Save Template'}
        </button>

        {isBuiltin ? (
          <button
            onClick={async () => {
              if (await confirm({
                title: 'Reset Template?',
                description: 'Reset to default template?',
                intent: 'warning'
              }))
                resetTplMut.mutate()
            }}
            disabled={resetTplMut.isPending}
            className="border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 text-sm rounded-lg px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {resetTplMut.isPending ? 'Resetting…' : 'Reset to Default'}
          </button>
        ) : (
          <button
            onClick={async () => {
              if (await confirm({
                title: 'Delete Custom Template?',
                description: 'Delete this custom template permanently?',
                intent: 'danger'
              })) deleteTplMut.mutate(tplKey)
            }}
            disabled={deleteTplMut.isPending}
            className="border border-red-200 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm rounded-lg px-4 py-2 disabled:opacity-50 transition-colors"
          >
            {deleteTplMut.isPending ? 'Deleting…' : 'Delete Template'}
          </button>
        )}

        {tplSaveMsg && (
          <span className="text-xs text-success font-medium">{tplSaveMsg}</span>
        )}
      </div>
    </div>
  )
}
