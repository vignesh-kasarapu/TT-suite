import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getEmailTemplates,
  getEmployeeEmails,
  sendCustomEmailToCandidate,
  EMAIL_TEMPLATE_LABELS,
  type EmailTemplate,
  type EmployeeEmail,
} from '../../api/client'
import RecipientInput from '../shared/RecipientInput'
import { useEscapeKey } from '../../lib/hooks'

const PLACEHOLDERS = ['{candidate_name}', '{job_title}', '{score}', '{years_experience}']

function fillPlaceholders(text: string, vars: Record<string, string>): string {
  return text
    .replace(/\{candidate_name\}/g, vars.candidate_name ?? '')
    .replace(/\{job_title\}/g, vars.job_title ?? '')
    .replace(/\{score\}/g, vars.score ?? '')
    .replace(/\{years_experience\}/g, vars.years_experience ?? '')
}

function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map((e) => e.trim()).filter(Boolean)
}

export interface BulkEmailRecipient {
  evaluationId: number
  candidateName: string
  jobTitle: string
  score: number
  yearsExperience: number | null
}

interface Props {
  recipients: BulkEmailRecipient[]
  onClose: () => void
  onSent: (result: { sent: number; failed: number }) => void
}

export default function BulkEmailComposerModal({ recipients, onClose, onSent }: Props) {
  const queryClient = useQueryClient()

  const { data: templates } = useQuery<EmailTemplate[]>({
    queryKey: ['emailTemplates'],
    queryFn: getEmailTemplates,
  })

  const { data: employeeEmails = [] } = useQuery<EmployeeEmail[]>({
    queryKey: ['employeeEmails'],
    queryFn: getEmployeeEmails,
  })

  useEscapeKey(onClose, true)

  const [selectedKey, setSelectedKey] = useState<string>('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [cc, setCc] = useState<string[]>([])
  const [bcc, setBcc] = useState<string[]>([])
  const [ccBccExpanded, setCcBccExpanded] = useState(false)
  const [meetingLink, setMeetingLink] = useState('')
  const [meetingCtaLabel, setMeetingCtaLabel] = useState('Join Meeting')
  const [generateQr, setGenerateQr] = useState(false)

  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(0)
  const [sendMsg, setSendMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!templates || templates.length === 0 || selectedKey) return
    const first = templates[0]
    setSelectedKey(first.key)
    setSubject(first.subject)
    setBody(first.body_text)
    setMeetingLink(first.meeting_link ?? '')
    setMeetingCtaLabel(first.meeting_cta_label ?? 'Join Meeting')
    setGenerateQr(first.generate_qr ?? false)
    setCc(parseEmailList(first.cc))
    setBcc(parseEmailList(first.bcc))
    if (first.cc || first.bcc) setCcBccExpanded(true)
  }, [templates])

  function handleTemplateSelect(key: string) {
    const tpl = templates?.find((t) => t.key === key)
    setSelectedKey(key)
    if (!tpl) return
    setSubject(tpl.subject)
    setBody(tpl.body_text)
    setMeetingLink(tpl.meeting_link ?? '')
    setMeetingCtaLabel(tpl.meeting_cta_label ?? 'Join Meeting')
    setGenerateQr(tpl.generate_qr ?? false)
    setCc(parseEmailList(tpl.cc))
    setBcc(parseEmailList(tpl.bcc))
  }

  async function handleSend() {
    setSending(true)
    setProgress(0)
    let sent = 0
    let failed = 0
    for (const r of recipients) {
      const vars: Record<string, string> = {
        candidate_name: r.candidateName,
        job_title: r.jobTitle,
        score: String(Math.round(r.score)),
        years_experience: r.yearsExperience != null ? String(r.yearsExperience.toFixed(1)) : 'N/A',
      }
      try {
        await sendCustomEmailToCandidate(
          r.evaluationId,
          fillPlaceholders(subject, vars),
          fillPlaceholders(body, vars),
          meetingLink || undefined,
          meetingCtaLabel || undefined,
          generateQr,
          undefined,
          cc.length > 0 ? cc : undefined,
          bcc.length > 0 ? bcc : undefined,
        )
        sent++
      } catch {
        failed++
      }
      setProgress((p) => p + 1)
    }
    setSending(false)
    queryClient.invalidateQueries({ queryKey: ['results'] })
    setSendMsg(`Sent ${sent}/${recipients.length}${failed > 0 ? `, ${failed} failed` : ''}.`)
    onSent({ sent, failed })
    setTimeout(onClose, 1500)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-gray-900/60 backdrop-blur-md px-4"
      onClick={sending ? undefined : onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-lg w-full p-6 border border-gray-200 dark:border-gray-700 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900 dark:text-gray-100 text-base">
            Compose Email — {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}
          </h2>
          {!sending && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="bg-accent-100/40 dark:bg-accent-900/30 rounded-xl px-3 py-2.5 mb-4 text-xs text-gray-600 dark:text-gray-300 max-h-24 overflow-y-auto">
          <span className="font-medium">To:</span> {recipients.map((r) => r.candidateName).join(', ')}
        </div>

        <div className="mb-3 border border-gray-200 dark:border-gray-600 rounded-xl overflow-visible">
          <button
            type="button"
            onClick={() => setCcBccExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors rounded-xl"
          >
            <span className="flex items-center gap-1.5">
              CC / BCC
              {(cc.length > 0 || bcc.length > 0) && (
                <span className="ml-1 bg-accent text-white px-1.5 py-0.5 rounded text-[10px]">{cc.length + bcc.length}</span>
              )}
            </span>
            <svg className={`w-3.5 h-3.5 transition-transform ${ccBccExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {ccBccExpanded && (
            <div className="px-3 pb-3 space-y-3 border-t border-gray-200 dark:border-gray-600 pt-3">
              <RecipientInput label="CC" recipients={cc} onAdd={(e) => setCc((prev) => [...prev, e])} onRemove={(e) => setCc((prev) => prev.filter((x) => x !== e))} suggestions={employeeEmails} />
              <RecipientInput label="BCC" recipients={bcc} onAdd={(e) => setBcc((prev) => [...prev, e])} onRemove={(e) => setBcc((prev) => prev.filter((x) => x !== e))} suggestions={employeeEmails} />
            </div>
          )}
        </div>

        <div className="mb-3">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">Template</label>
          <select
            value={selectedKey}
            onChange={(e) => handleTemplateSelect(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="">— No template —</option>
            {(templates ?? []).map((t) => (
              <option key={t.key} value={t.key}>
                {EMAIL_TEMPLATE_LABELS[t.key] ?? t.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3 text-[11px] text-gray-400 dark:text-gray-500 flex flex-wrap gap-1">
          <span className="mr-1">Personalized per recipient:</span>
          {PLACEHOLDERS.map((p) => (
            <code key={p} className="bg-gray-100 dark:bg-gray-800 px-1 rounded font-mono">{p}</code>
          ))}
        </div>

        <div className="mb-3">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Subject</label>
          <input
            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject"
          />
        </div>

        <div className="mb-4">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Body</label>
          <textarea
            rows={7}
            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 resize-y"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Email body…"
          />
        </div>

        {sending && (
          <div className="mb-3">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>Sending…</span>
              <span>{progress}/{recipients.length}</span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
              <div className="h-1.5 rounded-full bg-accent transition-all duration-300" style={{ width: `${(progress / recipients.length) * 100}%` }} />
            </div>
          </div>
        )}

        {sendMsg && (
          <p className="text-xs font-medium mb-3 text-success">{sendMsg}</p>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleSend}
            disabled={sending || !subject.trim() || !body.trim()}
            className="flex-1 bg-accent hover:bg-accent-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
          >
            {sending ? 'Sending…' : `Send to ${recipients.length}`}
          </button>
          {!sending && (
            <button
              onClick={onClose}
              className="px-4 py-2.5 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl text-sm transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
