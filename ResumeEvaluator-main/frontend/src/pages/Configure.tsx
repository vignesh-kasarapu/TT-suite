import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSkills,
  getJobRoles,
  createSkill,
  deleteSkill,
  createJobRole,
  updateJobRole,
  deleteJobRole,
  archiveJobRole,
  updateRequirements,
  updateJobRoleQuestions,
  setIntakePause,
  extractJdText,
  extractSkillsFromJd,
  extractFullConfigFromJd,
  getSystemStatus,
  runEvaluation,
  getEvaluationStatus,
} from '../api/client'
import type { JobRole, JobRoleRequirement, JobRoleQuestion, Skill, EvaluationStatus } from '../api/client'

/** One "Open Positions" card, built from the job roles (the public job board is gone in the TT Suite). */
interface JobCard {
  id: number
  title: string
  closes_at: string | null
  intake_paused: boolean
  min_experience: number
  max_experience?: number | null
  min_degree?: string | null
  primary_skill_names: string[]
}
import { useAppStore } from '../store/useAppStore'
import { useConfirm } from '../components/shared/ConfirmDialog'
import SmtpTestButton from '../components/Configure/SmtpTestButton'
import SkillsDndBoard from '../components/Configure/SkillsDndBoard'

const CATEGORIES = ['Programming', 'Framework', 'Database', 'Cloud', 'DevOps', 'ML/AI', 'Backend', 'Frontend', 'Other']

export default function Configure() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { selectedJobRoleId, setJobRole, showToast } = useAppStore()

  // ── Role form state ─────────────────────────────────────────────────────
  const [roleTitle, setRoleTitle] = useState('')
  const [minExp, setMinExp] = useState(0)
  const [maxExp, setMaxExp] = useState<number | ''>('')
  const [requiredSkillIds, setRequiredSkillIds] = useState<number[]>([])
  const [requiredSkillNames, setRequiredSkillNames] = useState<string[]>([])
  const [niceToHaveSkillIds, setNiceToHaveSkillIds] = useState<number[]>([])
  const [niceToHaveSkillNames, setNiceToHaveSkillNames] = useState<string[]>([])
  const [weights, setWeights] = useState({ projects: 50, skills: 30, education: 20 })
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErrMsg, setSaveErrMsg] = useState<string | null>(null)
  const confirm = useConfirm()

  // ── Requirements state ──────────────────────────────────────────────────
  type ReqDraft = Omit<JobRoleRequirement, 'id'>
  const [requirements, setRequirements] = useState<ReqDraft[]>([])
  const [reqSaveMsg, setReqSaveMsg] = useState<string | null>(null)
  const [expandedReqDesc, setExpandedReqDesc] = useState<Set<number>>(new Set())

  // ── Screening / knockout questions state ─────────────────────────────────
  type QuestionDraft = Omit<JobRoleQuestion, 'id'>
  const [questions, setQuestions] = useState<QuestionDraft[]>([])
  const [questionsSaveMsg, setQuestionsSaveMsg] = useState<string | null>(null)

  // ── Auto-pause / email state ─────────────────────────────────────────────
  const [shortlistTarget, setShortlistTarget] = useState<number | ''>('')
  const [minFitScore, setMinFitScore] = useState<number | ''>('')
  const [tfidfThreshold, setTfidfThreshold] = useState<number | ''>(0)
  const [intakePaused, setIntakePaused] = useState(false)
  const [isArchived, setIsArchived] = useState(false)
  const [autoEmailEnabled, setAutoEmailEnabled] = useState(true)

  // ── Job listing metadata state ───────────────────────────────────────────
  const [workType, setWorkType] = useState<'remote' | 'onsite' | 'hybrid' | ''>('')
  const [jobLocation, setJobLocation] = useState('')
  const [salaryMin, setSalaryMin] = useState<number | ''>('')
  const [salaryMax, setSalaryMax] = useState<number | ''>('')
  const [department, setDepartment] = useState('')
  const [employmentType, setEmploymentType] = useState<'full_time' | 'part_time' | 'contract' | 'internship' | ''>('')

  // ── Auto-save refs ──────────────────────────────────────────────────────
  const isLoadingRoleRef = useRef(false)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── JD / Education filter state ─────────────────────────────────────────
  const [jdDescription, setJdDescription] = useState('')
  const [jdUploading, setJdUploading] = useState(false)
  const [jdExtractMsg, setJdExtractMsg] = useState<string | null>(null)
  const [minDegree, setMinDegree] = useState<'bachelor' | 'master' | 'phd' | 'doctorate' | ''>('')
  const [preferredMajors, setPreferredMajors] = useState<string[]>([])
  const [majorInput, setMajorInput] = useState('')

  // ── Experience level filter state ────────────────────────────────────────
  const [filterExpLevels, setFilterExpLevels] = useState<string[]>([])
  const [minGradYear, setMinGradYear] = useState<number | ''>('')
  const [maxGradYear, setMaxGradYear] = useState<number | ''>('')
  const [isEntryLevel, setIsEntryLevel] = useState(false)
  const [requireGithub, setRequireGithub] = useState(false)


  // ── Skill browser state ─────────────────────────────────────────────────
  const [skillSearch, setSkillSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [newTaxSkillName, setNewTaxSkillName] = useState('')
  const [newTaxCategory, setNewTaxCategory] = useState('Other')

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data: skillsData } = useQuery({
    queryKey: ['skills', skillSearch, categoryFilter],
    queryFn: () => getSkills({ search: skillSearch || undefined, category: categoryFilter || undefined, limit: 100 }),
  })

  const { data: jobRoles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['jobRoles'],
    queryFn: getJobRoles,
  })

  const { data: systemStatus } = useQuery({
    queryKey: ['systemStatus'],
    queryFn: getSystemStatus,
    staleTime: 60_000,
  })

  const publicJobs: JobCard[] = (jobRoles as JobRole[])
    .filter((r) => !r.is_archived)
    .map((r) => ({
      id: r.id,
      title: r.title,
      closes_at: (r as JobRole & { closes_at?: string | null }).closes_at ?? null,
      intake_paused: r.intake_paused,
      min_experience: r.min_experience,
      max_experience: r.max_experience,
      min_degree: r.min_degree,
      primary_skill_names: r.skill_names.filter((_, i) => r.skill_required_flags[i]),
    }))


  // ── Run Evaluation state ──────────────────────────────────────────────────
  const [evalRoleId, setEvalRoleId] = useState<number | ''>('')
  const [evalMsg, setEvalMsg] = useState<string | null>(null)
  const [evalJobRoleId, setEvalJobRoleId] = useState<number | null>(null)

  const { data: evalStatus } = useQuery<EvaluationStatus>({
    queryKey: ['evalStatus', evalJobRoleId],
    queryFn: () => getEvaluationStatus(evalJobRoleId!),
    enabled: evalJobRoleId != null,
    refetchInterval: (query) => query.state.data?.in_progress ? 3000 : false,
  })

  const runEvalMut = useMutation({
    mutationFn: () => runEvaluation(Number(evalRoleId)),
    onSuccess: (data) => {
      if (data.queued_count === 0) {
        setEvalMsg('No resumes matched the job role filters. Check experience level / min years settings.')
        return
      }
      setEvalJobRoleId(Number(evalRoleId))
      queryClient.invalidateQueries({ queryKey: ['results'] })
      // Auto-redirect to Leaderboard
      navigate('/leaderboard')
    },
    onError: () => {
      setEvalMsg('Failed to start evaluation. Check backend logs.')
    },
  })

  const [rolesInitialized, setRolesInitialized] = useState(false)
  useEffect(() => {
    if ((jobRoles as JobRole[]).length === 0 || rolesInitialized) return
    setRolesInitialized(true)
    const roles = jobRoles as JobRole[]
    const target = selectedJobRoleId ? roles.find((r) => r.id === selectedJobRoleId) : undefined
    loadRole(target ?? roles[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobRoles])

  function loadRole(role: JobRole) {
    isLoadingRoleRef.current = true
    setJobRole(role.id)
    setRoleTitle(role.title)
    setMinExp(role.min_experience)
    setMaxExp(role.max_experience ?? '')
    const reqIds: number[] = [], nthIds: number[] = [], reqNames: string[] = [], nthNames: string[] = []
    ;(role.skill_ids ?? []).forEach((id, i) => {
      const name = (role.skill_names ?? [])[i] ?? ''
      const isReq = (role.skill_required_flags ?? [])[i] ?? true
      if (isReq) { reqIds.push(id); reqNames.push(name) }
      else { nthIds.push(id); nthNames.push(name) }
    })
    setRequiredSkillIds(reqIds)
    setRequiredSkillNames(reqNames)
    setNiceToHaveSkillIds(nthIds)
    setNiceToHaveSkillNames(nthNames)
    setWeights({
      projects: role.weight_projects,
      skills: role.weight_skills,
      education: role.weight_education,
    })
    setRequirements(
      (role.requirements ?? []).map(({ label, weight, req_type, description, min_years }) => ({
        label, weight, req_type, description, min_years,
      }))
    )
    setExpandedReqDesc(new Set())
    setQuestions(
      (role.questions ?? []).map(({ question_text, question_type, is_required, knockout_reject_on, order }) => ({
        question_text, question_type, is_required, knockout_reject_on, order,
      }))
    )
    setJdDescription(role.description ?? '')
    setMinDegree((role.min_degree as typeof minDegree) ?? '')
    setPreferredMajors(role.preferred_majors ?? [])
    setShortlistTarget(role.shortlist_target ?? '')
    setMinFitScore(role.min_fit_score ?? '')
    setTfidfThreshold(
      role.tfidf_threshold != null && role.tfidf_threshold > 0
        ? Number((role.tfidf_threshold * 100).toFixed(1))
        : 0
    )
    setIntakePaused(role.intake_paused ?? false)
    setIsArchived(role.is_archived ?? false)
    setAutoEmailEnabled(role.auto_email_enabled ?? true)
    setFilterExpLevels(role.filter_experience_levels ?? [])
    setMinGradYear(role.min_graduation_year ?? '')
    setMaxGradYear(role.max_graduation_year ?? '')
    setIsEntryLevel(role.is_entry_level ?? false)
    setRequireGithub(role.require_github ?? false)
    setWorkType((role.work_type as typeof workType) ?? '')
    setJobLocation(role.job_location ?? '')
    setSalaryMin(role.salary_min ?? '')
    setSalaryMax(role.salary_max ?? '')
    setDepartment(role.department ?? '')
    setEmploymentType((role.employment_type as typeof employmentType) ?? '')
    setTimeout(() => { isLoadingRoleRef.current = false }, 0)
  }

  // ── Mutations ────────────────────────────────────────────────────────────
  const createSkillMut = useMutation({
    mutationFn: ({ name, cat }: { name: string; cat: string }) => createSkill(name, cat),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  const deleteSkillMut = useMutation({
    mutationFn: (id: number) => deleteSkill(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  const saveRoleMut = useMutation({
    mutationFn: () => {
      const payload = {
        title: roleTitle,
        min_experience: minExp,
        max_experience: maxExp === '' ? null : maxExp,
        cosine_threshold: 0.8,
        weight_projects: weights.projects,
        weight_skills: weights.skills,
        weight_education: weights.education,
        skill_ids: [...requiredSkillIds, ...niceToHaveSkillIds],
        skill_required_flags: [
          ...requiredSkillIds.map(() => true),
          ...niceToHaveSkillIds.map(() => false),
        ],
        description: jdDescription || null,
        min_degree: minDegree || null,
        preferred_majors: preferredMajors,
        shortlist_target: shortlistTarget !== '' ? Number(shortlistTarget) : null,
        min_fit_score: minFitScore !== '' ? Number(minFitScore) : null,
        tfidf_threshold: tfidfThreshold !== '' ? Number(tfidfThreshold) / 100 : 0,
        filter_experience_levels: filterExpLevels,
        auto_email_enabled: autoEmailEnabled,
        min_graduation_year: minGradYear !== '' ? Number(minGradYear) : null,
        max_graduation_year: maxGradYear !== '' ? Number(maxGradYear) : null,
        is_entry_level: isEntryLevel,
        require_github: requireGithub,
        work_type: workType || null,
        job_location: jobLocation || null,
        salary_min: salaryMin !== '' ? Number(salaryMin) : null,
        salary_max: salaryMax !== '' ? Number(salaryMax) : null,
        department: department || null,
        employment_type: employmentType || null,
      }
      if (selectedJobRoleId) return updateJobRole(selectedJobRoleId, payload)
      return createJobRole(payload)
    },
    onSuccess: (role) => {
      setSaveErrMsg(null)
      queryClient.invalidateQueries({ queryKey: ['jobRoles'] })
      queryClient.invalidateQueries({ queryKey: ['job-roles'] })
      queryClient.invalidateQueries({ queryKey: ['public-jobs'] })
      setJobRole(role.id)
      setSaveMsg('Saved successfully')
      setTimeout(() => setSaveMsg(null), 2000)
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? err?.message ?? 'Unknown error'
      setSaveErrMsg(typeof detail === 'string' ? detail : JSON.stringify(detail))
    },
  })

  const saveReqMut = useMutation({
    mutationFn: () => {
      if (!selectedJobRoleId) throw new Error('No job role selected')
      return updateRequirements(selectedJobRoleId, requirements)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobRoles'] })
      setReqSaveMsg('Requirements saved')
      setTimeout(() => setReqSaveMsg(null), 2000)
    },
  })

  const saveQuestionsMut = useMutation({
    mutationFn: () => {
      if (!selectedJobRoleId) throw new Error('No job role selected')
      return updateJobRoleQuestions(selectedJobRoleId, questions)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobRoles'] })
      queryClient.invalidateQueries({ queryKey: ['job-roles'] })
      queryClient.invalidateQueries({ queryKey: ['public-jobs'] })
      setQuestionsSaveMsg('Questions saved')
      setTimeout(() => setQuestionsSaveMsg(null), 2000)
    },
  })

  const extractSkillsMut = useMutation({
    mutationFn: (text: string) => extractSkillsFromJd(text),
    onSuccess: (result) => {
      const addedReqIds: number[] = [], addedReqNames: string[] = []
      const addedNthIds: number[] = [], addedNthNames: string[] = []
      result.skill_ids.forEach((id, i) => {
        const name = result.skill_names[i]
        const isReq = result.skill_required?.[i] ?? true
        const alreadyAdded = requiredSkillIds.includes(id) || niceToHaveSkillIds.includes(id)
        if (alreadyAdded) return
        if (isReq) { addedReqIds.push(id); addedReqNames.push(name) }
        else { addedNthIds.push(id); addedNthNames.push(name) }
      })
      const totalAdded = addedReqIds.length + addedNthIds.length
      if (totalAdded === 0) {
        setJdExtractMsg('No new skills found in JD')
      } else {
        if (addedReqIds.length > 0) {
          setRequiredSkillIds((prev) => [...prev, ...addedReqIds])
          setRequiredSkillNames((prev) => [...prev, ...addedReqNames])
        }
        if (addedNthIds.length > 0) {
          setNiceToHaveSkillIds((prev) => [...prev, ...addedNthIds])
          setNiceToHaveSkillNames((prev) => [...prev, ...addedNthNames])
        }
        setJdExtractMsg(`${totalAdded} skill${totalAdded !== 1 ? 's' : ''} added from JD`)
      }
      setTimeout(() => setJdExtractMsg(null), 3000)
    },
    onError: () => setJdExtractMsg('Failed to extract skills'),
  })

  const extractFullConfigMut = useMutation({
    mutationFn: (text: string) => extractFullConfigFromJd(text),
    onSuccess: (result) => {
      if (result.title) setRoleTitle(result.title)
      if (typeof result.min_experience === 'number') setMinExp(result.min_experience)
      setMaxExp(typeof result.max_experience === 'number' ? result.max_experience : '')
      if (Array.isArray(result.filter_experience_levels)) setFilterExpLevels(result.filter_experience_levels)
      if (typeof result.is_entry_level === 'boolean') setIsEntryLevel(result.is_entry_level)
      if (result.work_type) setWorkType(result.work_type)
      if (result.employment_type) setEmploymentType(result.employment_type)
      if (result.department) setDepartment(result.department)
      if (result.job_location) setJobLocation(result.job_location)
      if (typeof result.salary_min === 'number') setSalaryMin(result.salary_min)
      if (typeof result.salary_max === 'number') setSalaryMax(result.salary_max)
      if (result.min_degree) setMinDegree(result.min_degree)
      if (Array.isArray(result.preferred_majors) && result.preferred_majors.length > 0) setPreferredMajors(result.preferred_majors)
      if (typeof result.require_github === 'boolean') setRequireGithub(result.require_github)
      if (typeof result.min_graduation_year === 'number') setMinGradYear(result.min_graduation_year)
      if (typeof result.max_graduation_year === 'number') setMaxGradYear(result.max_graduation_year)
    },
    onError: () => {
      setJdExtractMsg('Failed to extract role info from JD')
    }
  })

  const pauseMut = useMutation({
    mutationFn: (paused: boolean) => setIntakePause(selectedJobRoleId!, paused),
    onSuccess: (role) => {
      setIntakePaused(role.intake_paused)
      queryClient.invalidateQueries({ queryKey: ['jobRoles'] })
    },
  })

  const archiveMut = useMutation({
    mutationFn: (archived: boolean) => archiveJobRole(selectedJobRoleId!, archived),
    onSuccess: (role) => {
      setIsArchived(role.is_archived)
      queryClient.invalidateQueries({ queryKey: ['jobRoles'] })
      queryClient.invalidateQueries({ queryKey: ['job-roles'] })
    },
  })

  const deleteRoleMut = useMutation({
    mutationFn: (id: number) => deleteJobRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobRoles'] })
      queryClient.invalidateQueries({ queryKey: ['job-roles'] })
      setJobRole(null as unknown as number)
      setRoleTitle('')
      setMinExp(0)
      setMaxExp('')
      setRequiredSkillIds([])
      setRequiredSkillNames([])
      setNiceToHaveSkillIds([])
      setNiceToHaveSkillNames([])
      setWeights({ projects: 50, skills: 30, education: 20 })
      setJdDescription('')
      setMinDegree('')
      setPreferredMajors([])
      setShortlistTarget('')
      setMinFitScore('')
      setTfidfThreshold(0)
      setFilterExpLevels([])
      setMinGradYear('')
      setMaxGradYear('')
      setIntakePaused(false)
      setIsArchived(false)
      setAutoEmailEnabled(true)
      setRequirements([])
      setQuestions([])
      setRequireGithub(false)
      setWorkType('')
      setJobLocation('')
      setSalaryMin('')
      setSalaryMax('')
      setDepartment('')
      setEmploymentType('')
    },
  })

  // ── Auto-save weights (debounced 800 ms) ────────────────────────────────
  useEffect(() => {
    if (isLoadingRoleRef.current || !selectedJobRoleId || !roleTitle) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => saveRoleMut.mutate(), 800)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights.projects, weights.skills, weights.education])

  // ── Auto-save skills (debounced 300 ms) ─────────────────────────────────
  useEffect(() => {
    if (isLoadingRoleRef.current || !selectedJobRoleId || !roleTitle) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => saveRoleMut.mutate(), 300)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiredSkillIds, niceToHaveSkillIds])

  // ── Weight auto-adjust ───────────────────────────────────────────────────
  // When one slider moves, the other two redistribute proportionally so the
  // sum stays at 100, keeping the Save button always enabled.
  function handleWeightChange(changed: 'projects' | 'skills' | 'education', val: number) {
    const clamped = Math.max(0, Math.min(100, val))
    const remaining = 100 - clamped
    const others = (['projects', 'skills', 'education'] as const).filter((k) => k !== changed)
    const [keyA, keyB] = others
    const sumOthers = weights[keyA] + weights[keyB]
    let newA: number, newB: number
    if (sumOthers > 0) {
      newA = Math.round(remaining * weights[keyA] / sumOthers)
      newB = remaining - newA
    } else {
      newA = Math.floor(remaining / 2)
      newB = remaining - newA
    }
    setWeights({ [changed]: clamped, [keyA]: Math.max(0, newA), [keyB]: Math.max(0, newB) } as typeof weights)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function toggleSkill(skill: Skill) {
    const reqIdx = requiredSkillIds.indexOf(skill.id)
    const nthIdx = niceToHaveSkillIds.indexOf(skill.id)
    if (reqIdx !== -1) {
      // Required → Nice-to-have
      setRequiredSkillIds((prev) => prev.filter((_, i) => i !== reqIdx))
      setRequiredSkillNames((prev) => prev.filter((_, i) => i !== reqIdx))
      setNiceToHaveSkillIds((prev) => [...prev, skill.id])
      setNiceToHaveSkillNames((prev) => [...prev, skill.name])
    } else if (nthIdx !== -1) {
      // Nice-to-have → Remove
      setNiceToHaveSkillIds((prev) => prev.filter((_, i) => i !== nthIdx))
      setNiceToHaveSkillNames((prev) => prev.filter((_, i) => i !== nthIdx))
    } else {
      // Unselected → Required
      setRequiredSkillIds((prev) => [...prev, skill.id])
      setRequiredSkillNames((prev) => [...prev, skill.name])
    }
  }

  function removeRequiredSkill(idx: number) {
    setRequiredSkillIds((prev) => prev.filter((_, i) => i !== idx))
    setRequiredSkillNames((prev) => prev.filter((_, i) => i !== idx))
  }

  function removeNiceToHaveSkill(idx: number) {
    setNiceToHaveSkillIds((prev) => prev.filter((_, i) => i !== idx))
    setNiceToHaveSkillNames((prev) => prev.filter((_, i) => i !== idx))
  }

  const filteredSkills: Skill[] = skillsData?.items ?? []

  const inputCls = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40'

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* ── Left Sidebar ─────────────────────────────────────── */}
      <aside className="w-72 glass-panel border-r flex flex-col overflow-y-auto p-4 gap-5 rounded-none border-t-0 border-b-0 border-l-0">
        {/* Job role selector */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Job Role
              <span className="ml-1 font-normal normal-case text-gray-400">({(jobRoles as JobRole[]).length})</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setJobRole(null as unknown as number)
                  setRoleTitle('')
                  setMinExp(0)
                  setRequiredSkillIds([])
                  setRequiredSkillNames([])
                  setNiceToHaveSkillIds([])
                  setNiceToHaveSkillNames([])
                  setWeights({ projects: 50, skills: 30, education: 20 })
                  setJdDescription('')
                  setMinDegree('')
                  setPreferredMajors([])
                  setShortlistTarget('')
                  setMinFitScore('')
                  setTfidfThreshold(0)
                  setFilterExpLevels([])
                  setMinGradYear('')
                  setMaxGradYear('')
                  setIntakePaused(false)
                  setIsArchived(false)
                  setRequirements([])
                  setQuestions([])
                }}
                className="text-xs text-accent hover:text-accent-700 font-medium flex items-center gap-1"
                title="Create a new job role"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
                </svg>
                New
              </button>
              {selectedJobRoleId && (
                <button
                  onClick={async () => {
                    if (isArchived) {
                      archiveMut.mutate(false)
                      return
                    }
                    if (await confirm({
                      title: 'Archive Job Role?',
                      description: `Archive "${roleTitle}"? It will be hidden from the candidate portal, but evaluations and candidate data are kept. You can unarchive it anytime.`,
                      intent: 'warning'
                    })) {
                      archiveMut.mutate(true)
                    }
                  }}
                  disabled={archiveMut.isPending}
                  className="text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1 disabled:opacity-50"
                  title={isArchived ? 'Unarchive this job role' : 'Archive this job role — hide from candidate portal'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 01-2-2V5a1 1 0 011-1h16a1 1 0 011 1v1a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-7 4h0" />
                  </svg>
                  {archiveMut.isPending ? '…' : isArchived ? 'Unarchive' : 'Archive'}
                </button>
              )}
              {selectedJobRoleId && (
                <button
                  onClick={async () => {
                    if (await confirm({
                      title: 'Delete Job Role?',
                      description: `Delete "${roleTitle}"? This will remove all associated evaluations.`,
                      intent: 'danger'
                    })) {
                      deleteRoleMut.mutate(selectedJobRoleId)
                    }
                  }}
                  disabled={deleteRoleMut.isPending}
                  className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1 disabled:opacity-50"
                  title="Delete this job role"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
              )}
            </div>
          </div>
          <select
            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            value={selectedJobRoleId ?? ''}
            onChange={(e) => {
              const id = Number(e.target.value)
              const role = (jobRoles as JobRole[]).find((r) => r.id === id)
              if (role) loadRole(role)
            }}
          >
            {(jobRoles as JobRole[]).length === 0 && <option value="">No roles yet — create one</option>}
            {(jobRoles as JobRole[]).map((r) => (
              <option key={r.id} value={r.id}>{r.title}{r.is_archived ? ' 🗄 archived' : r.intake_paused ? ' ⏸ paused' : ''}</option>
            ))}
          </select>

          {/* Archived banner */}
          {selectedJobRoleId && isArchived && (
            <div className="mt-2 flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                Archived — hidden from candidate portal
              </span>
            </div>
          )}

          {/* Intake status + pause/resume toggle */}
          {selectedJobRoleId && (
            <div className={`mt-2 flex items-center justify-between px-3 py-2 rounded-lg border ${
              intakePaused
                ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-700'
                : 'bg-success-100 dark:bg-green-950/30 border-success-300 dark:border-green-700'
            }`}>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${intakePaused ? 'bg-amber-400' : 'bg-success animate-pulse'}`} />
                <span className={`text-xs font-semibold ${intakePaused ? 'text-amber-700 dark:text-amber-300' : 'text-success-800 dark:text-green-300'}`}>
                  {intakePaused ? 'Intake Paused' : 'Intake Active'}
                </span>
              </div>
              <button
                onClick={() => pauseMut.mutate(!intakePaused)}
                disabled={pauseMut.isPending}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded border transition-colors disabled:opacity-50 ${
                  intakePaused
                    ? 'border-success text-success hover:bg-success-100 dark:hover:bg-green-900/20'
                    : 'border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                }`}
              >
                {pauseMut.isPending ? '…' : intakePaused ? 'Resume' : 'Pause'}
              </button>
            </div>
          )}
        </div>

        {/* Skills summary counts — board is in main area below */}
        <div className="flex gap-3">
          <div className="flex-1 bg-accent-100/40 dark:bg-accent-900/30 rounded-lg px-3 py-2 text-center">
            <p className="text-lg font-bold text-accent">{requiredSkillIds.length}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Required</p>
          </div>
          <div className="flex-1 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2 text-center">
            <p className="text-lg font-bold text-amber-600">{niceToHaveSkillIds.length}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">Nice-to-Have</p>
          </div>
        </div>

        {/* Scoring Weights */}
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Scoring Weights
          </p>
          {(
            [
              { key: 'projects' as const, label: 'Projects', color: '#534AB7' },
              { key: 'skills' as const, label: 'Skills', color: '#1D9E75' },
              { key: 'education' as const, label: 'Education', color: '#EF9F27' },
            ]
          ).map(({ key, label, color }) => (
            <div key={key} className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-600 dark:text-gray-400 w-20 shrink-0">{label}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={weights[key]}
                onChange={(e) => handleWeightChange(key, Number(e.target.value))}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 text-right"
              />
              <span className="text-xs font-semibold shrink-0" style={{ color }}>%</span>
            </div>
          ))}
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Values auto-adjust to sum 100%</p>
        </div>
      </aside>

      {/* ── Main Area ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {rolesLoading && (
          <div className="animate-pulse space-y-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl p-5 space-y-4">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-40" />
                <div className="grid grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="space-y-1.5">
                      <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-24" />
                      <div className="h-9 bg-gray-100 dark:bg-gray-700 rounded-lg" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* ── Live Listings card ────────────────────────────────── */}
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Open Positions</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Your open job roles. Click a card to configure that role.
              </p>
            </div>
            <button
              onClick={() => navigate('/jobs/new')}
              className="flex items-center gap-1.5 text-xs font-semibold text-accent border border-accent/40 px-3 py-1.5 rounded-lg hover:bg-accent-100 dark:hover:bg-accent-900 transition-colors shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Post a Job
            </button>
          </div>

          {publicJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 gap-3">
              <p className="text-sm text-gray-400 dark:text-gray-500">No jobs published yet.</p>
              <button
                onClick={() => navigate('/jobs/new')}
                className="text-xs font-semibold text-accent border border-accent/40 px-4 py-1.5 rounded-lg hover:bg-accent-100 transition-colors"
              >
                Create your first job →
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {publicJobs.map((job: JobCard) => {
                const isSelected = job.id === selectedJobRoleId
                const isExpired = job.closes_at ? new Date(job.closes_at) < new Date() : false
                const isPaused = job.intake_paused || isExpired
                const deadlineStr = job.closes_at
                  ? new Date(job.closes_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                  : null
                const matchedRole = (jobRoles as JobRole[]).find((r) => r.id === job.id)
                return (
                  <div
                    key={job.id}
                    onClick={() => matchedRole && loadRole(matchedRole)}
                    className={`rounded-xl border p-4 cursor-pointer transition-all hover:shadow-sm ${
                      isSelected
                        ? 'border-accent bg-accent-100/30 dark:bg-accent-900/30 shadow-sm'
                        : 'border-gray-200 dark:border-gray-700 hover:border-accent/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-tight">{job.title}</p>
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        isPaused
                          ? 'bg-amber-50 text-amber-600 border-amber-200'
                          : 'bg-success-100 text-success-800 border-success-300'
                      }`}>
                        {isPaused ? (isExpired ? 'Expired' : 'Paused') : 'Live'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1 mb-2">
                      {job.min_experience != null && job.min_experience > 0 && (
                        <span className="text-[10px] text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">
                          {job.max_experience ? `${job.min_experience}-${job.max_experience} yrs` : `${job.min_experience}+ yrs`}
                        </span>
                      )}
                      {job.min_degree && (
                        <span className="text-[10px] text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full capitalize">
                          {job.min_degree}
                        </span>
                      )}
                      {deadlineStr && !isExpired && (
                        <span className="text-[10px] text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">
                          Closes {deadlineStr}
                        </span>
                      )}
                    </div>

                    {job.primary_skill_names.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {job.primary_skill_names.slice(0, 4).map((s) => (
                          <span key={s} className="text-[10px] font-medium bg-accent-100 text-accent-700 dark:bg-accent-900 dark:text-accent-300 px-1.5 py-0.5 rounded-full border border-accent-300/40">
                            {s}
                          </span>
                        ))}
                        {job.primary_skill_names.length > 4 && (
                          <span className="text-[10px] text-gray-400">+{job.primary_skill_names.length - 4}</span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 pt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); matchedRole && loadRole(matchedRole) }}
                        className="text-[11px] font-semibold text-accent hover:underline"
                      >
                        Configure →
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Active Job Role Card */}
        <div className="glass-card rounded-xl p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">
            {selectedJobRoleId ? 'Edit Job Role' : 'Create Job Role'}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Role Title</label>
              <input
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                className={inputCls}
                placeholder="e.g. Senior Backend Engineer"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Min. Experience (yrs)</label>
              <input
                type="number"
                min={0}
                value={minExp}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setMinExp(v)
                  if (maxExp !== '' && maxExp < v) setMaxExp(v)
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Max. Experience (yrs)</label>
              <input
                type="number"
                min={minExp}
                placeholder="Any"
                value={maxExp}
                onChange={(e) => {
                  const raw = e.target.value
                  setMaxExp(raw === '' ? '' : Math.max(minExp, Number(raw)))
                }}
                className={inputCls}
              />
            </div>
          </div>

          {/* Experience Level Filter */}
          <div className="mt-4">
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
              Candidate Level Filter
              <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">(only evaluate selected levels — leave empty to allow all)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {(['junior', 'mid', 'senior', 'executive'] as const).map((lvl) => {
                const checked = filterExpLevels.includes(lvl)
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() =>
                      setFilterExpLevels(
                        checked
                          ? filterExpLevels.filter((l) => l !== lvl)
                          : [...filterExpLevels, lvl]
                      )
                    }
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      checked
                        ? 'bg-accent text-white border-accent'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-accent'
                    }`}
                  >
                    {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  </button>
                )
              })}
              {filterExpLevels.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterExpLevels([])}
                  className="px-3 py-1 rounded-full text-xs font-medium border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Entry / Fresher / Intern Role Toggle */}
          <div className="mt-4">
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
              Scoring Mode
              <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">(entry-level scoring rewards design-oriented projects and skips recency decay)</span>
            </label>
            <button
              type="button"
              onClick={() => setIsEntryLevel(!isEntryLevel)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                isEntryLevel
                  ? 'bg-accent text-white border-accent'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-accent'
              }`}
            >
              Entry / Fresher / Intern
            </button>
          </div>

          {/* GitHub Prime Requirement Toggle */}
          <div className="mt-4">
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
              GitHub Requirement
              <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">(candidates missing a GitHub profile are flagged with a "Missed Requirement: GitHub" badge)</span>
            </label>
            <button
              type="button"
              onClick={() => setRequireGithub(!requireGithub)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                requireGithub
                  ? 'bg-accent text-white border-accent'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-accent'
              }`}
            >
              {requireGithub ? '✓ GitHub Required' : 'GitHub Optional'}
            </button>
          </div>

          {/* Job Listing Metadata */}
          <div className="mt-5 border-t border-gray-100 dark:border-gray-700 pt-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              Listing Details
              <span className="ml-1 font-normal normal-case text-gray-400 dark:text-gray-500">(for your team and shortlist emails)</span>
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Department / Team</label>
                <input
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Engineering, Product"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Location</label>
                <input
                  value={jobLocation}
                  onChange={(e) => setJobLocation(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Bangalore, India"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Work Type</label>
                <select
                  className={inputCls}
                  value={workType}
                  onChange={(e) => setWorkType(e.target.value as typeof workType)}
                >
                  <option value="">Not specified</option>
                  <option value="remote">Remote</option>
                  <option value="onsite">On-site</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Employment Type</label>
                <select
                  className={inputCls}
                  value={employmentType}
                  onChange={(e) => setEmploymentType(e.target.value as typeof employmentType)}
                >
                  <option value="">Not specified</option>
                  <option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option>
                  <option value="contract">Contract</option>
                  <option value="internship">Internship</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Salary Range (LPA)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    className={`${inputCls} flex-1`}
                    placeholder="Min"
                    value={salaryMin}
                    onChange={(e) => setSalaryMin(e.target.value ? Number(e.target.value) : '')}
                  />
                  <span className="text-xs text-gray-400 shrink-0">–</span>
                  <input
                    type="number"
                    min={0}
                    className={`${inputCls} flex-1`}
                    placeholder="Max"
                    value={salaryMax}
                    onChange={(e) => setSalaryMax(e.target.value ? Number(e.target.value) : '')}
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">L</span>
                </div>
              </div>
            </div>
          </div>

          {/* Graduation Year Range Filter */}
          <div className="mt-4">
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
              Graduation Year Range
              <span className="ml-1 font-normal text-gray-400">(resumes outside this range are filtered before evaluation — leave blank for no restriction)</span>
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">From</span>
                <input
                  type="number"
                  min={1980}
                  max={2040}
                  step={1}
                  className={`${inputCls} w-28`}
                  placeholder="e.g. 2025"
                  value={minGradYear}
                  onChange={(e) => setMinGradYear(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">To</span>
                <input
                  type="number"
                  min={1980}
                  max={2040}
                  step={1}
                  className={`${inputCls} w-28`}
                  placeholder="e.g. 2026"
                  value={maxGradYear}
                  onChange={(e) => setMaxGradYear(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              {(minGradYear !== '' || maxGradYear !== '') && (
                <button
                  type="button"
                  onClick={() => { setMinGradYear(''); setMaxGradYear('') }}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            {minGradYear !== '' && maxGradYear !== '' && Number(minGradYear) > Number(maxGradYear) && (
              <p className="text-xs text-danger mt-1">From year must be ≤ To year.</p>
            )}
          </div>

          {/* Auto-Pause Settings */}
          <div className="mt-5 border-t border-gray-100 dark:border-gray-700 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Auto-Pause Settings
              </p>
              {selectedJobRoleId && (
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                    intakePaused ? 'bg-danger-100 text-danger-800' : 'bg-success-100 text-success-800'
                  }`}>
                    {intakePaused ? 'Intake Paused' : 'Intake Active'}
                  </span>
                  <button
                    onClick={() => pauseMut.mutate(!intakePaused)}
                    disabled={pauseMut.isPending}
                    className={`text-xs font-medium border rounded-lg px-3 py-1 transition-colors disabled:opacity-50 ${
                      intakePaused
                        ? 'border-success text-success hover:bg-success-100'
                        : 'border-danger text-danger hover:bg-danger-100'
                    }`}
                  >
                    {pauseMut.isPending ? '…' : intakePaused ? 'Resume Intake' : 'Pause Intake'}
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Shortlist Target
                  <span className="ml-1 font-normal text-gray-400">(auto-pause after N qualified)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  placeholder="e.g. 10"
                  value={shortlistTarget}
                  onChange={(e) => setShortlistTarget(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                  Min Fit Score %
                  <span className="ml-1 font-normal text-gray-400">(to count as qualified)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={inputCls}
                  placeholder="e.g. 70"
                  value={minFitScore}
                  onChange={(e) => setMinFitScore(e.target.value ? Number(e.target.value) : '')}
                />
              </div>
            </div>

            {/* TF-IDF pre-filter threshold */}
            <div className="mt-4">
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block font-medium">
                TF-IDF Pre-filter Threshold
              </label>
              <div className="flex items-center gap-3 mb-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className={`${inputCls} w-32`}
                  placeholder="0"
                  value={tfidfThreshold}
                  onChange={(e) => setTfidfThreshold(e.target.value !== '' ? Number(e.target.value) : '')}
                />
                {(() => {
                  const v = Number(tfidfThreshold) || 0
                  if (v === 0) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">Disabled — all resumes go to LLM</span>
                  if (v < 5) return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">Light filter — only clearly off-topic removed</span>
                  if (v < 10) return <span className="text-xs px-2 py-0.5 rounded-full bg-success-100 text-success-800">Recommended — good balance of speed vs accuracy</span>
                  if (v < 20) return <span className="text-xs px-2 py-0.5 rounded-full bg-warning-100 text-warning-800">Strict — may filter borderline-relevant resumes</span>
                  return <span className="text-xs px-2 py-0.5 rounded-full bg-danger-100 text-danger-800">Very strict — high risk of false negatives</span>
                })()}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                Before sending a resume to the AI scorer, a fast keyword-similarity check runs against the job description.
                Resumes below this threshold are marked <span className="font-mono text-[10px] bg-gray-100 dark:bg-gray-700 px-1 rounded">tfidf_filtered</span> and skipped — reducing LLM cost on clearly irrelevant applicants.
                Set to <span className="font-semibold">0</span> to disable entirely. Suggested starting value: <span className="font-semibold">8%</span>.
              </p>
            </div>
          </div>

          {/* SMTP status row */}
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            {systemStatus && !systemStatus.smtp_configured ? (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700 px-3 py-2.5 flex-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  <strong>SMTP not configured.</strong> Set{' '}
                  <code className="font-mono bg-amber-100 dark:bg-amber-900/60 px-1 rounded">SMTP_SERVER</code>,{' '}
                  <code className="font-mono bg-amber-100 dark:bg-amber-900/60 px-1 rounded">SMTP_USERNAME</code>, and{' '}
                  <code className="font-mono bg-amber-100 dark:bg-amber-900/60 px-1 rounded">SMTP_FROM_EMAIL</code>{' '}
                  in your environment to enable outbound emails.
                </p>
              </div>
            ) : systemStatus?.smtp_configured ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-success-800 bg-success-100 px-2.5 py-1 rounded-full">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                SMTP configured
              </span>
            ) : null}
            {systemStatus?.smtp_configured && (
              <SmtpTestButton />
            )}
          </div>

          {/* Auto-email toggle */}
          <div className="mt-4 flex items-center gap-3 pb-1">
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Auto-send next-steps email</span>
            <button
              type="button"
              onClick={() => setAutoEmailEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoEmailEnabled ? 'bg-success' : 'bg-gray-300 dark:bg-gray-600'}`}
              title={autoEmailEnabled ? 'Auto-email ON — candidates scoring ≥85 get next-steps email automatically' : 'Auto-email OFF — only manual sends'}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${autoEmailEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
            </button>
            <span className={`text-xs font-semibold ${autoEmailEnabled ? 'text-success' : 'text-gray-400 dark:text-gray-500'}`}>
              {autoEmailEnabled ? 'On (score ≥ 85)' : 'Off'}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => saveRoleMut.mutate()}
              disabled={saveRoleMut.isPending || !roleTitle}
              className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white font-semibold rounded-lg px-5 py-2 text-sm transition-colors"
            >
              {saveRoleMut.isPending ? 'Saving…' : selectedJobRoleId ? 'Update Role' : 'Save Role'}
            </button>
            {saveMsg && <span className="text-xs text-success font-medium">{saveMsg}</span>}
            {saveErrMsg && (
              <span className="text-xs text-danger-800 max-w-xs truncate" title={saveErrMsg}>
                Save failed: {saveErrMsg}
              </span>
            )}
          </div>
        </div>

        {/* AI Scoring Context + Education Filters */}
        <div className="glass-card rounded-xl p-5 space-y-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">AI Scoring Context</h2>
              {systemStatus && (
                systemStatus.llm_configured ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border bg-success-100 dark:bg-success-900 text-success-800 dark:text-success-300 border-success-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                    {systemStatus.llm_provider === 'groq' ? 'Groq AI' : systemStatus.llm_provider}
                    {systemStatus.llm_model && <span className="opacity-70">· {systemStatus.llm_model}</span>}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                    TF-IDF fallback
                  </span>
                )
              )}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              The job description below is fed to the AI to score how well the resume aligns with the role. Education filters gate eligibility.
            </p>
          </div>

          {/* JD full text */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500 dark:text-gray-400">
                Full Job Description
                <span className="ml-1 text-gray-400 font-normal">(used by the AI for semantic alignment scoring)</span>
              </label>
              <label className={`cursor-pointer text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${jdUploading ? 'opacity-50 pointer-events-none' : 'border-accent text-accent hover:bg-accent-100'}`}>
                {jdUploading ? 'Extracting…' : 'Upload PDF/DOCX'}
                <input
                  type="file"
                  accept=".pdf,.docx,.doc"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setJdUploading(true)
                    try {
                      const result = await extractJdText(file)
                      setJdDescription(result.text)
                      extractSkillsMut.mutate(result.text)
                      extractFullConfigMut.mutate(result.text)
                    } catch {
                      showToast('Failed to extract text from file.', 'error')
                    } finally {
                      setJdUploading(false)
                      e.target.value = ''
                    }
                  }}
                />
              </label>
            </div>
            <textarea
              rows={6}
              className={`${inputCls} resize-y`}
              placeholder="Paste the full job description here, or upload a PDF/DOCX above…"
              value={jdDescription}
              onChange={(e) => setJdDescription(e.target.value)}
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => {
                  extractSkillsMut.mutate(jdDescription)
                  extractFullConfigMut.mutate(jdDescription)
                }}
                disabled={extractSkillsMut.isPending || extractFullConfigMut.isPending || !jdDescription.trim()}
                className="text-xs font-medium flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent text-white bg-accent hover:bg-accent-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                <span className="text-sm">🪄</span>
                {extractSkillsMut.isPending || extractFullConfigMut.isPending ? 'Extracting…' : 'Smart Fill All from JD'}
              </button>
              {jdExtractMsg && (
                <span className={`text-xs font-medium ${jdExtractMsg.startsWith('No') || jdExtractMsg.startsWith('Failed') ? 'text-gray-500 dark:text-gray-400' : 'text-success'}`}>
                  {jdExtractMsg}
                </span>
              )}
            </div>
          </div>

          {/* Degree + Majors row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Minimum Degree</label>
              <select
                className={inputCls}
                value={minDegree}
                onChange={(e) => setMinDegree(e.target.value as typeof minDegree)}
              >
                <option value="">No requirement</option>
                <option value="bachelor">Bachelor's</option>
                <option value="master">Master's</option>
                <option value="phd">PhD / Doctorate</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Preferred Majors</label>
              <div className="flex gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  placeholder="e.g. Computer Science"
                  value={majorInput}
                  onChange={(e) => setMajorInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && majorInput.trim()) {
                      if (!preferredMajors.includes(majorInput.trim())) {
                        setPreferredMajors([...preferredMajors, majorInput.trim()])
                      }
                      setMajorInput('')
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (majorInput.trim() && !preferredMajors.includes(majorInput.trim())) {
                      setPreferredMajors([...preferredMajors, majorInput.trim()])
                    }
                    setMajorInput('')
                  }}
                  className="bg-accent text-white text-xs px-3 py-1.5 rounded-lg hover:bg-accent-700"
                >
                  Add
                </button>
              </div>
              {preferredMajors.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {preferredMajors.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border bg-accent-100 text-accent-700 border-accent-300"
                    >
                      {m}
                      <button
                        onClick={() => setPreferredMajors(preferredMajors.filter((x) => x !== m))}
                        className="opacity-60 hover:opacity-100 leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Requirements Editor */}
        {selectedJobRoleId && (
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <div>
                <h2 className="font-semibold text-gray-800 dark:text-gray-100">Scoring Criteria</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  Custom scored requirements (e.g. "Python 3+ yrs", "AWS Certified", "CS degree"). Weights must sum to 100.
                  When saved these override the default Skills / Projects / Education split.
                </p>
              </div>
              {requirements.length > 0 && (() => {
                const total = requirements.reduce((s, r) => s + r.weight, 0)
                const isOk = Math.abs(total - 100) <= 0.5
                return (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                      isOk
                        ? 'bg-success-100 text-success-800 border-success-300'
                        : 'bg-danger-100 text-danger-800 border-danger'
                    }`}>
                      Total: {total.toFixed(0)}%{isOk ? ' ✓' : ' — needs 100'}
                    </span>
                    {!isOk && requirements.length > 0 && (
                      <button
                        onClick={() => {
                          const count = requirements.length
                          const base = Math.floor(100 / count)
                          const rem = 100 - base * count
                          setRequirements(requirements.map((r, i) => ({ ...r, weight: base + (i < rem ? 1 : 0) })))
                        }}
                        className="text-xs text-accent border border-accent/40 rounded-lg px-2.5 py-1 hover:bg-accent-100 transition-colors"
                      >
                        Auto-distribute
                      </button>
                    )}
                  </div>
                )
              })()}
            </div>

            <div className="space-y-3 mt-4 mb-3">
              {requirements.length === 0 && (
                <div className="text-center py-6 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-400 dark:text-gray-500">No custom requirements yet.</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Add criteria below to override the default scoring.</p>
                </div>
              )}
              {requirements.map((req, idx) => (
                <div key={idx} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3 space-y-2">
                  <div className="flex gap-2 items-start flex-wrap">
                    <input
                      className={`${inputCls} flex-[3] min-w-0`}
                      placeholder="Requirement label, e.g. 'Python 3+ yrs' or 'AWS Certified'"
                      value={req.label}
                      onChange={(e) => {
                        const updated = [...requirements]
                        updated[idx] = { ...updated[idx], label: e.target.value }
                        setRequirements(updated)
                      }}
                    />
                    <select
                      className={`${inputCls} flex-[1.2] min-w-0`}
                      value={req.req_type}
                      onChange={(e) => {
                        const updated = [...requirements]
                        updated[idx] = {
                          ...updated[idx],
                          req_type: e.target.value as JobRoleRequirement['req_type'],
                          min_years: e.target.value !== 'experience' ? null : updated[idx].min_years,
                        }
                        setRequirements(updated)
                      }}
                    >
                      <option value="skill">Skill</option>
                      <option value="experience">Experience</option>
                      <option value="education">Education</option>
                      <option value="other">Other</option>
                    </select>
                    {req.req_type === 'experience' && (
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          min={0}
                          max={50}
                          className={`${inputCls} w-16`}
                          placeholder="0"
                          value={req.min_years ?? ''}
                          onChange={(e) => {
                            const updated = [...requirements]
                            updated[idx] = { ...updated[idx], min_years: e.target.value ? Number(e.target.value) : null }
                            setRequirements(updated)
                          }}
                        />
                        <span className="text-xs text-gray-400 shrink-0">min yrs</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className={`${inputCls} w-16 text-right`}
                        value={req.weight}
                        onChange={(e) => {
                          const updated = [...requirements]
                          updated[idx] = { ...updated[idx], weight: Number(e.target.value) }
                          setRequirements(updated)
                        }}
                      />
                      <span className="text-xs font-semibold text-gray-500 shrink-0">%</span>
                    </div>
                    <button
                      onClick={() => {
                        setRequirements(requirements.filter((_, i) => i !== idx))
                        setExpandedReqDesc((prev) => {
                          const next = new Set(prev)
                          next.delete(idx)
                          return next
                        })
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-danger hover:bg-danger-100 transition-colors shrink-0"
                      title="Remove"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {expandedReqDesc.has(idx) || req.description ? (
                    <input
                      className={`${inputCls} text-xs`}
                      placeholder="Notes shown to the AI scorer as context for evidence…"
                      value={req.description ?? ''}
                      onChange={(e) => {
                        const updated = [...requirements]
                        updated[idx] = { ...updated[idx], description: e.target.value || null }
                        setRequirements(updated)
                      }}
                    />
                  ) : (
                    <button
                      className="text-[11px] text-gray-400 hover:text-accent transition-colors flex items-center gap-1"
                      onClick={() => setExpandedReqDesc((prev) => new Set([...prev, idx]))}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add description
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 border-t border-gray-100 dark:border-gray-700 pt-3 flex-wrap">
              <button
                onClick={() => {
                  const count = requirements.length + 1
                  const base = Math.floor(100 / count)
                  const rem = 100 - base * count
                  const redistributed = requirements.map((r, i) => ({ ...r, weight: base + (i < rem ? 1 : 0) }))
                  setRequirements([...redistributed, { label: '', weight: base + (requirements.length < rem ? 1 : 0), req_type: 'skill', description: null, min_years: null }])
                }}
                className="flex items-center gap-1.5 text-xs text-accent border border-accent/40 rounded-lg px-3 py-1.5 hover:bg-accent-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add requirement
              </button>
              {requirements.length > 0 && (
                <button
                  onClick={async () => {
                    if (await confirm({
                      title: 'Clear Requirements?',
                      description: 'Clear all requirements? The default Skills/Projects/Education scoring will apply.',
                      intent: 'danger'
                    })) {
                      setRequirements([])
                      saveReqMut.mutate()
                    }
                  }}
                  className="text-xs text-gray-400 hover:text-danger transition-colors"
                >
                  Clear all
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                {reqSaveMsg && <span className="text-xs text-success font-medium">{reqSaveMsg}</span>}
                {saveReqMut.isError && <span className="text-xs text-danger-800">Save failed.</span>}
                <button
                  onClick={() => saveReqMut.mutate()}
                  disabled={
                    saveReqMut.isPending ||
                    (requirements.length > 0 && Math.abs(requirements.reduce((s, r) => s + r.weight, 0) - 100) > 0.5)
                  }
                  className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg px-4 py-1.5 transition-colors"
                >
                  {saveReqMut.isPending ? 'Saving…' : 'Save Criteria'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Screening / Knockout Questions Editor */}
        {selectedJobRoleId && (
          <div className="glass-card rounded-xl p-5">
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Screening Questions</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Custom questions candidates must answer to apply (e.g. "Do you require visa sponsorship?").
                Yes/No questions can be set to auto-flag the application when a disqualifying answer is given.
              </p>
            </div>

            <div className="space-y-3 mt-4 mb-3">
              {questions.length === 0 && (
                <div className="text-center py-6 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-400 dark:text-gray-500">No screening questions yet.</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Add a question below to require it on the application form.</p>
                </div>
              )}
              {questions.map((q, idx) => (
                <div key={idx} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3 space-y-2">
                  <div className="flex gap-2 items-start flex-wrap">
                    <input
                      className={`${inputCls} flex-[3] min-w-0`}
                      placeholder={'Question, e.g. "Do you require visa sponsorship?"'}
                      value={q.question_text}
                      onChange={(e) => {
                        const updated = [...questions]
                        updated[idx] = { ...updated[idx], question_text: e.target.value }
                        setQuestions(updated)
                      }}
                    />
                    <select
                      className={`${inputCls} flex-[1.2] min-w-0`}
                      value={q.question_type}
                      onChange={(e) => {
                        const updated = [...questions]
                        updated[idx] = {
                          ...updated[idx],
                          question_type: e.target.value as JobRoleQuestion['question_type'],
                          knockout_reject_on: e.target.value !== 'yes_no' ? null : updated[idx].knockout_reject_on,
                        }
                        setQuestions(updated)
                      }}
                    >
                      <option value="yes_no">Yes / No</option>
                      <option value="text">Free text</option>
                    </select>
                    {q.question_type === 'yes_no' && (
                      <select
                        className={`${inputCls} flex-[1.4] min-w-0`}
                        value={q.knockout_reject_on ?? ''}
                        onChange={(e) => {
                          const updated = [...questions]
                          updated[idx] = { ...updated[idx], knockout_reject_on: (e.target.value || null) as 'yes' | 'no' | null }
                          setQuestions(updated)
                        }}
                      >
                        <option value="">No auto-reject</option>
                        <option value="yes">Reject if answer is "Yes"</option>
                        <option value="no">Reject if answer is "No"</option>
                      </select>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 shrink-0">
                      <input
                        type="checkbox"
                        checked={q.is_required}
                        onChange={(e) => {
                          const updated = [...questions]
                          updated[idx] = { ...updated[idx], is_required: e.target.checked }
                          setQuestions(updated)
                        }}
                        className="accent-accent"
                      />
                      Required
                    </label>
                    <button
                      onClick={() => setQuestions(questions.filter((_, i) => i !== idx))}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-danger hover:bg-danger-100 transition-colors shrink-0"
                      title="Remove"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 border-t border-gray-100 dark:border-gray-700 pt-3 flex-wrap">
              <button
                onClick={() => {
                  setQuestions([
                    ...questions,
                    { question_text: '', question_type: 'yes_no', is_required: true, knockout_reject_on: null, order: questions.length },
                  ])
                }}
                className="flex items-center gap-1.5 text-xs text-accent border border-accent/40 rounded-lg px-3 py-1.5 hover:bg-accent-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add question
              </button>
              <div className="ml-auto flex items-center gap-2">
                {questionsSaveMsg && <span className="text-xs text-success font-medium">{questionsSaveMsg}</span>}
                {saveQuestionsMut.isError && <span className="text-xs text-danger-800">Save failed.</span>}
                <button
                  onClick={() => saveQuestionsMut.mutate()}
                  disabled={saveQuestionsMut.isPending || questions.some((q) => !q.question_text.trim())}
                  className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg px-4 py-1.5 transition-colors"
                >
                  {saveQuestionsMut.isPending ? 'Saving…' : 'Save Questions'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Drag-and-Drop JD Skills Board ─────────────────────────────── */}
        <div className="glass-card rounded-xl p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Skills Board</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            Drag skills between columns, or click to cycle: <span className="font-medium text-accent">Required ✓</span> → <span className="font-medium text-amber-600">Nice-to-have ★</span> → removed.
          </p>
          <div className="flex gap-2 mb-4">
            <input
              className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="Search skills…"
              value={skillSearch}
              onChange={(e) => setSkillSearch(e.target.value)}
            />
            <select
              className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* ── 3-column DnD board ─────────────────────────────────── */}
          <SkillsDndBoard
            filteredSkills={filteredSkills}
            requiredSkillIds={requiredSkillIds}
            requiredSkillNames={requiredSkillNames}
            niceToHaveSkillIds={niceToHaveSkillIds}
            niceToHaveSkillNames={niceToHaveSkillNames}
            toggleSkill={toggleSkill}
            removeRequiredSkill={removeRequiredSkill}
            removeNiceToHaveSkill={removeNiceToHaveSkill}
            setRequiredSkillIds={setRequiredSkillIds}
            setRequiredSkillNames={setRequiredSkillNames}
            setNiceToHaveSkillIds={setNiceToHaveSkillIds}
            setNiceToHaveSkillNames={setNiceToHaveSkillNames}
            deleteSkillMut={deleteSkillMut}
          />

          {/* Add new skill to taxonomy */}
          <div className="flex gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
            <input
              className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="New skill name…"
              value={newTaxSkillName}
              onChange={(e) => setNewTaxSkillName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTaxSkillName.trim()) {
                  createSkillMut.mutate({ name: newTaxSkillName.trim(), cat: newTaxCategory })
                  setNewTaxSkillName('')
                }
              }}
            />
            <select
              className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none"
              value={newTaxCategory}
              onChange={(e) => setNewTaxCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={() => {
                if (newTaxSkillName.trim()) {
                  createSkillMut.mutate({ name: newTaxSkillName.trim(), cat: newTaxCategory })
                  setNewTaxSkillName('')
                }
              }}
              disabled={createSkillMut.isPending}
              className="bg-accent text-white text-xs px-3 py-1.5 rounded-lg hover:bg-accent-700 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        {/* ── Run Evaluation ───────────────────────────────────────────── */}
        <div className="glass-card rounded-xl p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3">Run Evaluation</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            Score all uploaded resumes against this job role. You will be redirected to the Leaderboard automatically.
          </p>
          <div className="flex gap-2">
            <select
              className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              value={evalRoleId}
              onChange={(e) => { setEvalRoleId(e.target.value ? Number(e.target.value) : ''); setEvalMsg(null) }}
            >
              <option value="">Select a job role…</option>
              {(jobRoles as JobRole[]).map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
            <button
              onClick={() => { setEvalMsg(null); runEvalMut.mutate() }}
              disabled={runEvalMut.isPending || !evalRoleId}
              className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors shrink-0"
            >
              {runEvalMut.isPending ? 'Queuing…' : 'Run Evaluation'}
            </button>
          </div>
          {evalMsg && (
            <p className="text-xs text-danger-800 mt-2">{evalMsg}</p>
          )}
          {evalStatus && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {evalStatus.in_progress
                    ? <span className="text-accent font-medium animate-pulse">Evaluating…</span>
                    : <span className="text-success font-medium">Evaluation complete</span>}
                </span>
                <span>{evalStatus.scored}/{evalStatus.total} scored</span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-1.5 rounded-full transition-all duration-500"
                  style={{
                    width: evalStatus.total > 0 ? `${Math.round((evalStatus.scored / evalStatus.total) * 100)}%` : '0%',
                    backgroundColor: evalStatus.in_progress ? '#534AB7' : '#1D9E75',
                  }}
                />
              </div>
              <div className="flex gap-3 text-[10px] text-gray-400">
                {evalStatus.queued > 0 && <span>{evalStatus.queued} queued</span>}
                {evalStatus.filtered > 0 && <span>{evalStatus.filtered} filtered</span>}
                {evalStatus.error > 0 && <span className="text-red-400">{evalStatus.error} error{evalStatus.error !== 1 ? 's' : ''}</span>}
                {!evalStatus.in_progress && (
                  <button
                    onClick={() => navigate('/leaderboard')}
                    className="ml-auto text-accent hover:underline font-medium"
                  >
                    View results →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Email Templates moved to Uploads & Email Templates page */}

      </div>
    </div>
  )
}
