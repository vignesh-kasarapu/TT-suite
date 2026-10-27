import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

interface Props {
  evaluationId: number
  candidateName: string
  jobTitle: string
  score: number
  yearsExperience: number | null
  defaultTemplateKey?: string
  onClose: () => void
  onSent: () => void
}

export default function EmailComposerModal({
  evaluationId,
  candidateName,
  jobTitle,
  score,
  yearsExperience,
  defaultTemplateKey,
  onClose,
  onSent,
}: Props) {
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
  const [sendMsg, setSendMsg] = useState<string | null>(null)

  // CC / BCC state
  const [ccBccExpanded, setCcBccExpanded] = useState(false)
  const [cc, setCc] = useState<string[]>([])
  const [bcc, setBcc] = useState<string[]>([])

  // Meeting / video link state
  const [meetingExpanded, setMeetingExpanded] = useState(false)
  const [meetingLink, setMeetingLink] = useState('')
  const [meetingCtaLabel, setMeetingCtaLabel] = useState('Join Meeting')
  const [generateQr, setGenerateQr] = useState(false)

  // Attachment state
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const vars: Record<string, string> = {
    candidate_name: candidateName,
    job_title: jobTitle,
    score: String(Math.round(score)),
    years_experience: yearsExperience != null ? String(yearsExperience.toFixed(1)) : 'N/A',
  }

  useEffect(() => {
    if (!templates || templates.length === 0) return
    if (!selectedKey) {
      const preferred = defaultTemplateKey ? templates.find((t) => t.key === defaultTemplateKey) : null
      const first = preferred ?? templates[0]
      setSelectedKey(first.key)
      setSubject(fillPlaceholders(first.subject, vars))
      setBody(fillPlaceholders(first.body_text, vars))
      if (first.meeting_link) setMeetingLink(first.meeting_link)
      if (first.meeting_cta_label) setMeetingCtaLabel(first.meeting_cta_label)
      setGenerateQr(first.generate_qr ?? false)
      setCc(parseEmailList(first.cc))
      setBcc(parseEmailList(first.bcc))
      if (first.cc || first.bcc) setCcBccExpanded(true)
    }
  }, [templates])

  const handleTemplateSelect = (key: string) => {
    const tpl = templates?.find((t) => t.key === key)
    setSelectedKey(key)
    if (!tpl) return
    setSubject(fillPlaceholders(tpl.subject, vars))
    setBody(fillPlaceholders(tpl.body_text, vars))
    setMeetingLink(tpl.meeting_link ?? '')
    setMeetingCtaLabel(tpl.meeting_cta_label ?? 'Join Meeting')
    setGenerateQr(tpl.generate_qr ?? false)
    if (tpl.meeting_link) setMeetingExpanded(true)
    const newCc = parseEmailList(tpl.cc)
    const newBcc = parseEmailList(tpl.bcc)
    setCc(newCc)
    setBcc(newBcc)
    if (newCc.length > 0 || newBcc.length > 0) setCcBccExpanded(true)
  }

  const addFiles = (newFiles: File[]) => {
    const combined = [...files, ...newFiles].slice(0, 5)
    const totalSize = combined.reduce((s, f) => s + f.size, 0)
    if (totalSize > 10 * 1024 * 1024) {
      setSendMsg('Total attachment size exceeds 10 MB')
      return
    }
    setSendMsg(null)
    setFiles(combined)
  }

  const removeFile = (idx: number) => setFiles((fs) => fs.filter((_, i) => i !== idx))

  const sendMut = useMutation({
    mutationFn: () =>
      sendCustomEmailToCandidate(
        evaluationId,
        subject,
        body,
        meetingLink || undefined,
        meetingCtaLabel || undefined,
        generateQr,
        files.length > 0 ? files : undefined,
        cc.length > 0 ? cc : undefined,
        bcc.length > 0 ? bcc : undefined,
      ),
    onSuccess: () => {
      setSendMsg('Email sent successfully!')
      queryClient.invalidateQueries({ queryKey: ['results'] })
      setTimeout(() => {
        onSent()
        onClose()
      }, 1200)
    },
    onError: (err: any) => {
      setSendMsg(err?.response?.data?.detail ?? 'Failed to send email.')
    },
  })

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-gray-900/60 backdrop-blur-md px-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-lg w-full p-6 border border-gray-200 dark:border-gray-700 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900 dark:text-gray-100 text-base">Compose Email</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Candidate info */}
        <div className="bg-accent-100/40 dark:bg-accent-900/30 rounded-xl px-3 py-2.5 mb-4 text-xs text-gray-600 dark:text-gray-300 flex flex-wrap gap-x-4 gap-y-1">
          <span><span className="font-medium">To:</span> {candidateName}</span>
          <span><span className="font-medium">Role:</span> {jobTitle}</span>
          <span><span className="font-medium">Score:</span> {Math.round(score)}</span>
        </div>

        {/* CC / BCC — expandable */}
        <div className="mb-3 border border-gray-200 dark:border-gray-600 rounded-xl overflow-visible">
          <button
            type="button"
            onClick={() => setCcBccExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors rounded-xl"
          >
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              CC / BCC
              {(cc.length > 0 || bcc.length > 0) && (
                <span className="ml-1 bg-accent text-white px-1.5 py-0.5 rounded text-[10px]">
                  {cc.length + bcc.length}
                </span>
              )}
            </span>
            <svg
              className={`w-3.5 h-3.5 transition-transform ${ccBccExpanded ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {ccBccExpanded && (
            <div className="px-3 pb-3 space-y-3 border-t border-gray-200 dark:border-gray-600 pt-3">
              <RecipientInput
                label="CC"
                recipients={cc}
                onAdd={(e) => setCc((prev) => [...prev, e])}
                onRemove={(e) => setCc((prev) => prev.filter((x) => x !== e))}
                suggestions={employeeEmails}
              />
              <RecipientInput
                label="BCC"
                recipients={bcc}
                onAdd={(e) => setBcc((prev) => [...prev, e])}
                onRemove={(e) => setBcc((prev) => prev.filter((x) => x !== e))}
                suggestions={employeeEmails}
              />
            </div>
          )}
        </div>

        {/* Template selector — dropdown */}
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

        {/* Available placeholders */}
        <div className="mb-3 text-[11px] text-gray-400 dark:text-gray-500 flex flex-wrap gap-1">
          <span className="mr-1">Placeholders:</span>
          {PLACEHOLDERS.map((p) => (
            <code key={p} className="bg-gray-100 dark:bg-gray-800 px-1 rounded font-mono">{p}</code>
          ))}
        </div>

        {/* Subject */}
        <div className="mb-3">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Subject</label>
          <input
            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject"
          />
        </div>

        {/* Body */}
        <div className="mb-3">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">Body</label>
          <textarea
            rows={7}
            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 resize-y"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Email body…"
          />
        </div>

        {/* Meeting / Video Link — expandable */}
        <div className="mb-3 border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setMeetingExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Meeting / Video Link
              {meetingLink && <span className="ml-1 bg-accent text-white px-1.5 py-0.5 rounded text-[10px]">set</span>}
            </span>
            <svg
              className={`w-3.5 h-3.5 transition-transform ${meetingExpanded ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {meetingExpanded && (
            <div className="px-3 pb-3 space-y-2 border-t border-gray-200 dark:border-gray-600 pt-3">
              <div>
                <label className="text-[11px] text-gray-400 dark:text-gray-500 mb-1 block">Meeting URL</label>
                <input
                  className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  placeholder="https://meet.google.com/…"
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 dark:text-gray-500 mb-1 block">Button label</label>
                <input
                  className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  placeholder="Join Meeting"
                  value={meetingCtaLabel}
                  onChange={(e) => setMeetingCtaLabel(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={generateQr}
                  onChange={(e) => setGenerateQr(e.target.checked)}
                  className="rounded border-gray-300 text-accent focus:ring-accent/30"
                />
                Generate QR code for mobile scanning
              </label>
            </div>
          )}
        </div>

        {/* Document Attachments */}
        <div className="mb-4">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
            Attachments{' '}
            <span className="text-gray-400 font-normal">(up to 5 files · 10 MB total)</span>
          </label>
          <div
            className={`border-2 border-dashed rounded-xl px-3 py-4 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-accent bg-accent-100/20'
                : 'border-gray-200 dark:border-gray-600 hover:border-accent dark:hover:border-accent'
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              addFiles(Array.from(e.dataTransfer.files))
            }}
          >
            <svg className="w-5 h-5 mx-auto mb-1 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            <p className="text-xs text-gray-400 dark:text-gray-500">Drop files here or <span className="text-accent">click to browse</span></p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
            />
          </div>

          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-1.5">
                  <span className="truncate max-w-xs text-gray-700 dark:text-gray-300">{f.name}</span>
                  <span className="text-gray-400 ml-2 flex-shrink-0 mr-2">
                    {f.size < 1024 * 1024 ? `${Math.round(f.size / 1024)} KB` : `${(f.size / 1024 / 1024).toFixed(1)} MB`}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-gray-400 hover:text-red-500 flex-shrink-0 text-base leading-none"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {sendMsg && (
          <p className={`text-xs font-medium mb-3 ${sendMsg.includes('successfully') ? 'text-success' : 'text-red-500'}`}>
            {sendMsg}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => sendMut.mutate()}
            disabled={sendMut.isPending || !subject.trim() || !body.trim()}
            className="flex-1 bg-accent hover:bg-accent-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
          >
            {sendMut.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Sending…
              </span>
            ) : 'Send Email'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
