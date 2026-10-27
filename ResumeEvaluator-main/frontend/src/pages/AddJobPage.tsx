import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createJobRole,
  extractJdText,
  extractSkillsFromJd,
  extractFullConfigFromJd,
} from '../api/client'
import type { JdFullConfigResponse } from '../api/client'
import { useAppStore } from '../store/useAppStore'

interface ExtractedSkill {
  id: number
  name: string
  required: boolean
}

const DEGREE_OPTIONS = [
  { label: 'Any', value: null },
  { label: "Bachelor's", value: 'bachelor' },
  { label: "Master's", value: 'master' },
  { label: 'PhD', value: 'phd' },
] as const

// ── Drag-and-drop JD zone ─────────────────────────────────────────────────────
function JdDropZone({
  onFile,
  jdText,
  setJdText,
  extracting,
  onExtract,
  extractMsg,
  fileName,
}: {
  onFile: (f: File) => void
  jdText: string
  setJdText: (t: string) => void
  extracting: boolean
  onExtract: () => void
  extractMsg: string | null
  fileName: string | null
}) {
  const [dragging, setDragging] = useState(false)
  const [mode, setMode] = useState<'drop' | 'paste'>('drop')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) {
        onFile(file)
        setMode('drop')
      }
    },
    [onFile],
  )

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
        <button
          type="button"
          onClick={() => setMode('drop')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            mode === 'drop'
              ? 'bg-white dark:bg-gray-700 text-accent shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          📄 Upload File
        </button>
        <button
          type="button"
          onClick={() => setMode('paste')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            mode === 'paste'
              ? 'bg-white dark:bg-gray-700 text-accent shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          📋 Paste Text
        </button>
      </div>

      {mode === 'drop' ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => !extracting && inputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-10 px-6 text-center cursor-pointer transition-all select-none ${
            extracting
              ? 'border-accent bg-accent-100 dark:bg-accent-950 cursor-wait'
              : dragging
              ? 'border-accent bg-accent-100 dark:bg-accent-900 scale-[1.01]'
              : fileName
              ? 'border-success bg-success-100 dark:bg-[#0d2e22]'
              : 'border-gray-300 dark:border-gray-600 hover:border-accent hover:bg-gray-50 dark:hover:bg-gray-800/50'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.doc"
            className="sr-only"
            disabled={extracting}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) { onFile(f); setMode('drop') }
              if (inputRef.current) inputRef.current.value = ''
            }}
          />

          {extracting ? (
            <>
              <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                <svg className="w-6 h-6 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-accent">{extractMsg ?? 'Analysing JD…'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Extracting title, experience requirements & skills
                </p>
              </div>
            </>
          ) : fileName ? (
            <>
              <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center text-2xl">
                ✅
              </div>
              <div>
                <p className="text-sm font-semibold text-success">JD processed successfully</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{fileName}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  Click or drop a new file to replace
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-100 to-[#d4d0fc] dark:from-accent-900 dark:to-accent-950 flex items-center justify-center text-3xl shadow-inner">
                📄
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  Drop your Job Description here
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  or <span className="text-accent font-semibold">click to browse</span> from your computer
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {['PDF', 'DOCX', 'DOC'].map((fmt) => (
                  <span
                    key={fmt}
                    className="text-[10px] font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2 py-0.5 rounded"
                  >
                    {fmt}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                We'll auto-fill title, experience & skills
              </p>
            </>
          )}
        </div>
      ) : (
        /* Paste mode */
        <div className="space-y-2">
          <textarea
            rows={7}
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the full job description here — we'll extract the title, required experience, and skills automatically…"
            className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 resize-y"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onExtract}
              disabled={!jdText.trim() || extracting}
              className="flex items-center gap-2 bg-accent hover:bg-accent-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              {extracting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Extracting…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Extract from JD
                </>
              )}
            </button>
            {extractMsg && (
              <span
                className={`text-xs font-medium ${
                  extractMsg.startsWith('Extracted') ? 'text-success' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {extractMsg.startsWith('Extracted') ? '✓ ' : ''}
                {extractMsg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AddJobPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { role } = useAppStore()
  const isAdmin = role === 'admin' || role === 'recruiter'

  // JD state
  const [jdText, setJdText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractMsg, setExtractMsg] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  // Job fields
  const [title, setTitle] = useState('')
  const [minExp, setMinExp] = useState(0)
  const [maxExp, setMaxExp] = useState<number | null>(null)
  const [minDegree, setMinDegree] = useState<'bachelor' | 'master' | 'phd' | null>(null)
  const [skills, setSkills] = useState<ExtractedSkill[]>([])
  const [extracted, setExtracted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fullConfig, setFullConfig] = useState<JdFullConfigResponse | null>(null)

  // ── Extract from text ──────────────────────────────────────────────────────
  async function handleExtract(text: string) {
    if (!text.trim()) return
    setExtracting(true)
    setExtractMsg('Analysing JD…')
    setError(null)
    try {
      const [meta, skillsRes] = await Promise.all([
        extractFullConfigFromJd(text),
        extractSkillsFromJd(text),
      ])
      setFullConfig(meta)
      if (meta.title) setTitle(meta.title)
      if (meta.min_experience != null) setMinExp(meta.min_experience)
      setMaxExp(meta.max_experience ?? null)
      if (meta.min_degree === 'bachelor' || meta.min_degree === 'master' || meta.min_degree === 'phd') {
        setMinDegree(meta.min_degree)
      }
      const merged: ExtractedSkill[] = skillsRes.skill_ids.map((id, i) => ({
        id,
        name: skillsRes.skill_names[i],
        required: skillsRes.skill_required[i] ?? true,
      }))
      setSkills(merged)
      setExtracted(true)
      setExtractMsg(`Extracted ${merged.length} skill${merged.length !== 1 ? 's' : ''}`)
      setTimeout(() => setExtractMsg(null), 4000)
    } catch {
      setExtractMsg(null)
      setError('Extraction failed. Check that the backend is running and try again.')
    } finally {
      setExtracting(false)
    }
  }

  // ── Handle dropped / selected file ─────────────────────────────────────────
  const handleFile = useCallback(
    async (file: File) => {
      setExtracting(true)
      setExtractMsg('Reading file…')
      setError(null)
      setFileName(file.name)
      try {
        const result = await extractJdText(file)
        setJdText(result.text)
        await handleExtract(result.text)
      } catch {
        setExtractMsg(null)
        setFileName(null)
        setError('Failed to read file. Only PDF and DOCX are supported.')
        setExtracting(false)
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )

  function removeSkill(id: number) {
    setSkills((prev) => prev.filter((s) => s.id !== id))
  }
  function toggleRequired(id: number) {
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, required: !s.required } : s)))
  }

  // ── Create ─────────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: () =>
      createJobRole({
        title: title.trim(),
        min_experience: minExp,
        max_experience: maxExp,
        weight_projects: 40,
        weight_skills: 40,
        weight_education: 20,
        cosine_threshold: 0.3,
        skill_ids: skills.map((s) => s.id),
        skill_required_flags: skills.map((s) => s.required),
        shortlist_target: null,
        min_fit_score: null,
        description: jdText.trim() || null,
        min_degree: minDegree,
        // We cast to any to pass the optional metadata extracted by LLM,
        // in case the backend was updated to accept them but the frontend type wasn't.
        preferred_majors: fullConfig?.preferred_majors,
        filter_experience_levels: fullConfig?.filter_experience_levels,
        is_entry_level: fullConfig?.is_entry_level,
        work_type: fullConfig?.work_type,
        employment_type: fullConfig?.employment_type,
        department: fullConfig?.department,
        job_location: fullConfig?.job_location,
        salary_min: fullConfig?.salary_min,
        salary_max: fullConfig?.salary_max,
        require_github: fullConfig?.require_github,
        min_graduation_year: fullConfig?.min_graduation_year,
        max_graduation_year: fullConfig?.max_graduation_year,
      } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-roles'] })
      queryClient.invalidateQueries({ queryKey: ['jobRoles'] })
      queryClient.invalidateQueries({ queryKey: ['public-jobs'] })
      navigate('/configure')
    },
    onError: (err: any) => {
      setError(err?.response?.data?.detail ?? 'Failed to create job. Please try again.')
    },
  })

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
        <div className="text-center px-6">
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Only recruiters and admins can create job roles.
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            className="bg-accent text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-accent-700 transition-colors"
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  const requiredSkills = skills.filter((s) => s.required)
  const optionalSkills = skills.filter((s) => !s.required)

  return (
    <div className="p-6">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Back */}
        <button
          onClick={() => navigate('/configure')}
          className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-accent dark:hover:text-accent-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Job Roles
        </button>

        {/* Header */}
        <div>
          <span className="inline-block text-xs font-semibold text-accent bg-accent-100 dark:bg-accent-900 dark:text-accent-300 px-3 py-1 rounded-full mb-3 tracking-wide uppercase">
            Post a Job
          </span>
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white">Create a new position</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            Drop a PDF / DOCX Job Description and we'll auto-fill everything — or fill in the fields manually.
          </p>
        </div>

        {/* ── Step 1: JD Upload / Paste ───────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 space-y-4 shadow-sm">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center shrink-0">
              1
            </span>
            Job Description
            <span className="text-gray-400 font-normal text-xs">(optional — auto-fills all fields)</span>
          </h2>

          <JdDropZone
            onFile={handleFile}
            jdText={jdText}
            setJdText={setJdText}
            extracting={extracting}
            onExtract={() => handleExtract(jdText)}
            extractMsg={extractMsg}
            fileName={fileName}
          />
        </div>

        {/* ── Step 2: Job Details ──────────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 space-y-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center shrink-0">
              2
            </span>
            Job Details
            {extracted && (
              <span className="text-[10px] font-semibold text-success bg-success-100 px-2 py-0.5 rounded-full ml-1">
                ✓ Auto-filled
              </span>
            )}
          </h2>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              Job Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Backend Engineer"
              className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          {/* Experience Range */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              Years of Experience
            </label>
            <div className="flex items-center gap-3 mb-2">
              <input
                type="number"
                min={0}
                max={30}
                value={minExp}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value))
                  setMinExp(v)
                  if (maxExp != null && maxExp < v) setMaxExp(v)
                }}
                className="w-20 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <span className="text-sm text-gray-400">to</span>
              <input
                type="number"
                min={minExp}
                max={40}
                placeholder="Any"
                value={maxExp ?? ''}
                onChange={(e) => {
                  const raw = e.target.value
                  setMaxExp(raw === '' ? null : Math.max(minExp, Number(raw)))
                }}
                className="w-20 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <span className="text-sm text-gray-400">years</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3, 5, 8].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMinExp(v)}
                  className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-all ${
                    minExp === v
                      ? 'bg-accent text-white border-accent'
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-accent/50'
                  }`}
                >
                  {v === 0 ? 'Any' : `${v}+`}
                </button>
              ))}
            </div>
          </div>

          {/* Min Degree */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              Minimum Degree
            </label>
            <div className="flex flex-wrap gap-1.5">
              {DEGREE_OPTIONS.map((d) => (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => setMinDegree(d.value)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                    minDegree === d.value
                      ? 'bg-accent text-white border-accent'
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-accent/50'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Step 3: Skills ───────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2 mb-4">
            <span className="w-5 h-5 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center shrink-0">
              3
            </span>
            Skills
            {skills.length > 0 && (
              <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 ml-1">
                {skills.length} extracted — click a skill to toggle required/optional
              </span>
            )}
          </h2>

          {skills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="text-4xl mb-3 opacity-40">🔍</span>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                {jdText.trim()
                  ? 'Skills will appear here after extraction.'
                  : 'Drop a JD file or paste text above to auto-populate skills.'}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                You can also add skills manually in Configure after creation.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {requiredSkills.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-accent dark:text-accent-300 uppercase tracking-wide mb-2">
                    Required ({requiredSkills.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {requiredSkills.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => toggleRequired(s.id)}
                        title="Click to make optional"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent text-white text-xs font-medium border border-accent cursor-pointer select-none"
                      >
                        {s.name}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeSkill(s.id) }}
                          className="opacity-60 hover:opacity-100 text-[10px] leading-none ml-0.5"
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {optionalSkills.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                    Nice-to-Have ({optionalSkills.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {optionalSkills.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => toggleRequired(s.id)}
                        title="Click to make required"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium border border-gray-200 dark:border-gray-600 cursor-pointer select-none"
                      >
                        {s.name}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeSkill(s.id) }}
                          className="opacity-50 hover:opacity-100 text-[10px] leading-none ml-0.5"
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-gray-400 dark:text-gray-500 pt-1">
                Purple = required · Grey = nice-to-have · Click to toggle · × to remove
              </p>
            </div>
          )}
        </div>

        {/* ── Error ──────────────────────────────────────────────────────────── */}
        {error && (
          <div className="bg-danger-100 dark:bg-[#3a1515] border border-danger/30 rounded-xl px-4 py-3 text-sm text-danger-800 dark:text-danger">
            {error}
          </div>
        )}

        {/* ── Submit ─────────────────────────────────────────────────────────── */}
        <div className="flex gap-3 pb-6">
          <button
            type="button"
            disabled={!title.trim() || createMut.isPending}
            onClick={() => { setError(null); createMut.mutate() }}
            className="flex-1 flex items-center justify-center gap-2 bg-accent hover:bg-accent-700 disabled:opacity-40 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
          >
            {createMut.isPending ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Create Job
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate('/configure')}
            className="px-5 py-3 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
        </div>

        <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center -mt-3 pb-4">
          Add scoring weights & advanced settings in Job Roles after creation.
        </p>
      </div>
    </div>
  )
}
