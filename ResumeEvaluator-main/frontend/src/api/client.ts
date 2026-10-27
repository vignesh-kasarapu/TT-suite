/// <reference types="vite/client" />
import axios from 'axios'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Skill {
  id: number
  name: string
  category: string
  created_at: string
}

export interface SkillsParams {
  page?: number
  limit?: number
  category?: string
  search?: string
}

export interface PaginatedSkills {
  items: Skill[]
  total: number
  page: number
  limit: number
}

export interface ScoringWeights {
  projects: number
  skills: number
  education: number
}

export interface JobRoleRequirement {
  id: number
  label: string
  weight: number
  req_type: 'skill' | 'experience' | 'education' | 'other'
  description?: string | null
  min_years?: number | null
}

export interface JobRoleQuestion {
  id: number
  question_text: string
  question_type: 'yes_no' | 'text'
  is_required: boolean
  knockout_reject_on?: 'yes' | 'no' | null
  order: number
}

/** Screening question as shown to candidates — no knockout_reject_on (not disclosed). */
export interface PublicJobRoleQuestion {
  id: number
  question_text: string
  question_type: 'yes_no' | 'text'
  is_required: boolean
}

export interface RequirementBreakdown {
  requirement_id: number
  label: string
  req_type: string
  weight: number
  score: number
  evidence?: string | null
}

export interface JobRole {
  id: number
  title: string
  min_experience: number
  max_experience?: number | null
  weight_projects: number
  weight_skills: number
  weight_education: number
  cosine_threshold: number
  skill_ids: number[]
  skill_names: string[]
  skill_required_flags: boolean[]
  intake_paused: boolean
  shortlist_target: number | null
  min_fit_score: number | null
  created_at: string
  requirements: JobRoleRequirement[]
  questions: JobRoleQuestion[]
  description?: string | null
  min_degree?: 'bachelor' | 'master' | 'phd' | 'doctorate' | null
  preferred_majors: string[]
  filter_experience_levels: string[]
  auto_email_enabled: boolean
  tfidf_threshold: number
  min_graduation_year?: number | null
  max_graduation_year?: number | null
  is_entry_level: boolean
  require_github: boolean
  work_type?: 'remote' | 'onsite' | 'hybrid' | null
  job_location?: string | null
  salary_min?: number | null
  salary_max?: number | null
  department?: string | null
  employment_type?: 'full_time' | 'part_time' | 'contract' | 'internship' | null
  is_archived: boolean
}

export interface JobRoleCreate {
  title: string
  min_experience: number
  max_experience?: number | null
  weight_projects: number
  weight_skills: number
  weight_education: number
  cosine_threshold: number
  skill_ids: number[]
  skill_required_flags?: boolean[]
  shortlist_target?: number | null
  min_fit_score?: number | null
  description?: string | null
  min_degree?: 'bachelor' | 'master' | 'phd' | 'doctorate' | null
  preferred_majors?: string[]
  filter_experience_levels?: string[]
  auto_email_enabled?: boolean
  min_graduation_year?: number | null
  max_graduation_year?: number | null
  is_entry_level?: boolean
  require_github?: boolean
}

// ─── Enrichment ──────────────────────────────────────────────────────────────

export interface GitHubLanguage {
  language: string
  repo_count: number
}

export interface GitHubRepo {
  name: string
  description: string | null
  language: string | null
  stars: number
  matched_skills: string[]
}

export interface GitHubSummary {
  username: string
  public_repos: number
  languages: GitHubLanguage[]
  relevant_repos: GitHubRepo[]
  activity_score: number
  inferred_skills: { name: string; source: string; evidence: string[] }[]
  error: string | null
}

export interface ConsistencyFlag {
  severity: 'low' | 'medium' | 'high'
  field: string
  flag_type: string
  resume_value: string | null
  linkedin_value: string | null
  recruiter_note: string
}

export interface PortfolioSummary {
  url: string
  title: string
  description: string
  tech_stack: string[]
  project_snippets: string[]
  error: string | null
}

export interface EnrichmentData {
  candidate_id: number
  linkedin_url: string | null
  github_url: string | null
  portfolio_url: string | null
  github_summary: GitHubSummary | null
  linkedin_data: Record<string, unknown> | null
  portfolio_summary: PortfolioSummary | null
  consistency_flags: ConsistencyFlag[]
  needs_manual_review: boolean
  enrichment_sources: string[]
  error?: string | null
}

export interface UploadResponse {
  resume_id: number
  candidate_id: number
  duplicate_status: string
  sections_detected: string[]
  candidate_name: string
  candidate_email: string | null
  candidate_phone?: string | null
  candidate_current_title?: string | null
  candidate_experience_level?: string | null
  candidate_years_experience?: number | null
  candidate_graduation_year?: number | null
  candidate_location?: string | null
}

export interface ResultsParams {
  job_role_id?: number
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
  status?: string
  search?: string
}

export type ShortlistStatus = 'shortlisted' | 'review' | 'rejected'
export type OutcomeType = 'hired' | 'rejected' | 'ghosted' | 'declined'

export interface SkillMatch {
  skill_name: string
  score: number
  confidence: number
  best_section: 'projects' | 'skills_section' | 'skills' | 'certifications' | 'education' | 'experience' | 'work_experience' | 'unknown'
  excerpt?: string
}

export interface Excerpt {
  text: string
  cosine_score: number
  confidence_tier: 'high' | 'medium' | 'low'
  line_start: number
  line_end: number
  section: string
}

export interface SectionScore {
  section: string
  score: number
  weight: number
}

export interface CandidateResult {
  evaluation_id: number
  candidate_id: number
  resume_id: number
  candidate_name: string
  candidate_email: string
  candidate_phone?: string | null
  candidate_current_title?: string | null
  candidate_experience_level?: string | null
  candidate_years_experience?: number | null
  candidate_graduation_year?: number | null
  total_score: number
  project_score: number
  skill_score: number
  education_score: number
  experience_score: number
  skills_matched: number
  skills_total: number
  matched_skill_names: string[]
  project_match_score: number
  project_match_label: 'High' | 'Med' | 'Low'
  status: ShortlistStatus | 'pending' | 'parsing' | 'scoring' | 'done' | 'error'
  job_role_id: number
  job_role_title: string
  needs_manual_review: boolean
  evaluated_at: string
  email_sent_at: string | null
  email_opened_at: string | null
  candidate_stage: CandidateStage
  tfidf_score: number | null
  filter_stage: 'llm_scored' | 'tfidf_filtered' | 'experience_filtered'
  github_skill_gap_severity?: 'low' | 'medium' | 'high' | null
  missed_requirements?: string[]
  github_url?: string | null
  candidate_location?: string | null
}

export interface PaginatedResults {
  items: CandidateResult[]
  total: number
  page: number
  limit: number
}

export interface ScreeningAnswer {
  question_id: number
  question_text: string
  answer: string
  is_knockout: boolean
}

export interface EvaluationDetail {
  id: number
  resume_id: number
  candidate_id: number
  candidate_name: string
  candidate_email: string
  job_role_id: number
  job_role_title: string
  total_score: number
  project_score: number
  skill_score: number
  education_score: number
  experience_score: number
  skills_matched: SkillMatch[]
  skill_gaps: string[]
  excerpts: string[]
  resume_text: string
  resume_sections: ResumeSection[]
  status: string
  shortlist_status: ShortlistStatus | null
  notes: string | null
  evaluated_at: string
  requirements_breakdown: RequirementBreakdown[]
  reasoning_summary?: string | null
  interview_questions?: string[]
  email_sent_at?: string | null
  email_opened_at?: string | null
  github_url?: string | null
  linkedin_url?: string | null
  portfolio_url?: string | null
  confidence_tiers?: { high: string[]; medium: string[]; low: string[] }
  tfidf_score?: number | null
  interview_scheduled_at?: string | null
  interview_link?: string | null
  cover_letter?: string | null
  screening_answers?: ScreeningAnswer[]
  knockout_failed?: boolean
  tags?: string[]
}

export interface ResumeSection {
  type: string
  title: string
  start_line: number
  end_line: number
  text: string
  confidence: number
  weight_multiplier: number
}

export async function scheduleInterview(
  evaluationId: number,
  scheduledAt: string | null,
  link: string | null
): Promise<{ evaluation_id: number; interview_scheduled_at: string | null; interview_link: string | null }> {
  const { data } = await apiClient.patch(`/results/${evaluationId}/schedule-interview`, {
    interview_scheduled_at: scheduledAt,
    interview_link: link,
  })
  return data
}

export async function updateResumeSections(
  evaluationId: number,
  sections: ResumeSection[]
): Promise<void> {
  await apiClient.patch(`/results/${evaluationId}/sections`, { sections })
}

export async function reclassifyAndRescore(evaluationId: number): Promise<{ sections: number; message: string }> {
  const { data } = await apiClient.post<{ sections: number; message: string }>(
    `/results/${evaluationId}/reclassify-and-rescore`
  )
  return data
}

// ─── Axios Instance ──────────────────────────────────────────────────────────

// TT Suite: same origin, behind the portal gateway (/resume/api/* -> this app's /api/*). Sign-in is
// the portal's session cookie; every write carries X-Requested-With: XHR (the CSRF check).
export const API_BASE_URL = `${import.meta.env.BASE_URL}api/v1`

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XHR' },
})

/** The suite sign-in page, coming back here afterwards. */
export function goToSuiteLogin(): void {
  const here = window.location.pathname + window.location.search
  window.location.assign(`/login?returnTo=${encodeURIComponent(here)}`)
}

// 401: the suite session ended -> sign in again. 403 NO_APP_ACCESS: the role was removed -> dashboard.
apiClient.interceptors.response.use(
  (response: any) => response,
  (error: any) => {
    const status = error.response?.status
    const code = error.response?.data?.code
    if (status === 401 && code === 'UNAUTHENTICATED') goToSuiteLogin()
    else if (status === 403 && code === 'NO_APP_ACCESS') window.location.assign('/?denied=resume')
    return Promise.reject(error)
  }
)

// ─── Who am I ────────────────────────────────────────────────────────────────

export interface CurrentUser {
  id: number
  email: string
  name: string
  role: 'admin' | 'recruiter'
  permissions: Record<string, boolean>
}

export async function getMe(): Promise<CurrentUser> {
  const { data } = await apiClient.get<CurrentUser>('/auth/me')
  return data
}

// ─── Skills ──────────────────────────────────────────────────────────────────

export async function getSkills(params?: SkillsParams): Promise<PaginatedSkills> {
  const { data } = await apiClient.get<PaginatedSkills>('/skills', { params })
  return data
}

export async function createSkill(name: string, category: string): Promise<Skill> {
  const { data } = await apiClient.post<Skill>('/skills', { name, category })
  return data
}

export async function deleteSkill(id: number): Promise<void> {
  await apiClient.delete(`/skills/${id}`)
}

export async function extractSkillsFromJd(text: string): Promise<{ skill_ids: number[]; skill_names: string[]; skill_required: boolean[] }> {
  const { data } = await apiClient.post<{ skill_ids: number[]; skill_names: string[]; skill_required: boolean[] }>(
    '/skills/extract-from-jd',
    { text }
  )
  return data
}

export interface JdMetadataResponse {
  title?: string
  min_experience?: number
  max_experience?: number | null
  filter_experience_levels?: string[]
  is_entry_level?: boolean
}

export async function extractMetadataFromJd(text: string): Promise<JdMetadataResponse> {
  const { data } = await apiClient.post<JdMetadataResponse>(
    '/skills/extract-metadata-from-jd',
    { text }
  )
  return data
}

export interface JdFullConfigResponse {
  title?: string
  min_experience?: number
  max_experience?: number | null
  filter_experience_levels?: string[]
  is_entry_level?: boolean
  work_type?: 'remote' | 'onsite' | 'hybrid' | null
  employment_type?: 'full_time' | 'part_time' | 'contract' | 'internship' | null
  department?: string | null
  job_location?: string | null
  salary_min?: number | null
  salary_max?: number | null
  min_degree?: 'bachelor' | 'master' | 'phd' | 'doctorate' | null
  preferred_majors?: string[]
  require_github?: boolean
  min_graduation_year?: number | null
  max_graduation_year?: number | null
}

export async function extractFullConfigFromJd(text: string): Promise<JdFullConfigResponse> {
  const { data } = await apiClient.post<JdFullConfigResponse>(
    '/skills/extract-full-config-from-jd',
    { text }
  )
  return data
}

export async function extractFullConfigFromFile(file: File): Promise<JdFullConfigResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await apiClient.post<JdFullConfigResponse>(
    '/skills/extract-full-config-from-file',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return data
}

// ─── Job Roles ───────────────────────────────────────────────────────────────

export async function getJobRoles(): Promise<JobRole[]> {
  const { data } = await apiClient.get<JobRole[]>('/job-roles')
  return data
}

export async function createJobRole(payload: JobRoleCreate): Promise<JobRole> {
  const { data } = await apiClient.post<JobRole>('/job-roles', payload)
  return data
}

export async function updateJobRole(id: number, payload: JobRoleCreate): Promise<JobRole> {
  const { data } = await apiClient.put<JobRole>(`/job-roles/${id}`, payload)
  return data
}

export async function deleteJobRole(id: number): Promise<void> {
  await apiClient.delete(`/job-roles/${id}`)
}

export async function archiveJobRole(id: number, archived: boolean): Promise<JobRole> {
  const { data } = await apiClient.patch<JobRole>(`/job-roles/${id}/archive`, { archived })
  return data
}

export async function updateRequirements(
  roleId: number,
  requirements: Omit<JobRoleRequirement, 'id'>[]
): Promise<JobRoleRequirement[]> {
  const { data } = await apiClient.put<JobRoleRequirement[]>(
    `/job-roles/${roleId}/requirements`,
    { requirements }
  )
  return data
}

export async function updateJobRoleQuestions(
  roleId: number,
  questions: Omit<JobRoleQuestion, 'id'>[]
): Promise<JobRoleQuestion[]> {
  const { data } = await apiClient.put<JobRoleQuestion[]>(
    `/job-roles/${roleId}/questions`,
    { questions }
  )
  return data
}

// ─── Upload ──────────────────────────────────────────────────────────────────

export interface ParseSettings {
  ocrFallback: boolean
  stripHeaders: boolean
  detectTables: boolean
  multilingualNlp: boolean
}

export async function uploadResume(
  file: File,
  candidateName: string,
  candidateEmail: string,
  parseSettings?: ParseSettings
): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  form.append('candidate_name', candidateName)
  form.append('candidate_email', candidateEmail)
  form.append('consent_given', 'true') // Added for GDPR compliance
  if (parseSettings) {
    form.append('ocr_fallback', String(parseSettings.ocrFallback))
    form.append('strip_headers', String(parseSettings.stripHeaders))
    form.append('detect_tables', String(parseSettings.detectTables))
    form.append('multilingual_nlp', String(parseSettings.multilingualNlp))
  }
  const { data } = await apiClient.post<UploadResponse>('/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export interface ZipUploadItem {
  filename: string
  status: 'unique' | 'duplicate' | 'near_duplicate' | 'error'
  candidate_id?: number
  candidate_name?: string
  error?: string
}

export interface ZipUploadResponse {
  total_files: number
  parsed_count: number
  duplicate_count: number
  error_count: number
  skipped_count: number
  items: ZipUploadItem[]
}

export async function uploadZip(file: File, parseSettings?: ParseSettings): Promise<ZipUploadResponse> {
  const form = new FormData()
  form.append('file', file)
  form.append('consent_given', 'true') // Added for GDPR compliance
  if (parseSettings) {
    form.append('ocr_fallback', String(parseSettings.ocrFallback))
    form.append('strip_headers', String(parseSettings.stripHeaders))
    form.append('detect_tables', String(parseSettings.detectTables))
    form.append('multilingual_nlp', String(parseSettings.multilingualNlp))
  }
  const { data } = await apiClient.post<ZipUploadResponse>('/upload/zip', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

// ─── Evaluate ────────────────────────────────────────────────────────────────

export async function runEvaluation(
  jobRoleId: number,
  resumeIds?: number[],
  weights?: ScoringWeights
): Promise<{ job_id: string; queued_count: number }> {
  const { data } = await apiClient.post<{ job_id: string; queued_count: number }>('/evaluate', {
    job_role_id: jobRoleId,
    resume_ids: resumeIds,
    weights,
  })
  return data
}

export async function bulkRerun(jobRoleId: number): Promise<void> {
  await apiClient.post(`/evaluate/rerun`, { job_role_id: jobRoleId })
}

export async function pauseEvaluation(jobRoleId: number): Promise<void> {
  await apiClient.post(`/evaluate/pause?job_role_id=${jobRoleId}`)
}

export async function resumeEvaluation(jobRoleId: number): Promise<{ queued_count: number; message?: string }> {
  const { data } = await apiClient.post<{ queued_count: number; message?: string }>(
    `/evaluate/resume?job_role_id=${jobRoleId}`
  )
  return data
}

export interface ResultsSummary {
  total: number
  avg_score: number
  shortlisted: number
  needs_review: number
  pending: number
  tfidf_filtered: number
  experience_filtered: number
  queued: number
}

export async function getResultsSummary(jobRoleId?: number): Promise<ResultsSummary> {
  const params: Record<string, unknown> = {}
  if (jobRoleId != null) params.job_role_id = jobRoleId
  const { data } = await apiClient.get<ResultsSummary>('/results/summary', { params })
  return data
}

export interface EvaluationStatus {
  job_role_id: number
  total: number
  scored: number
  queued: number
  processing: number
  filtered: number
  error: number
  in_progress: boolean
  paused: boolean
}

export async function getEvaluationStatus(jobRoleId: number): Promise<EvaluationStatus> {
  const { data } = await apiClient.get<EvaluationStatus>(`/evaluate/status?job_role_id=${jobRoleId}`)
  return data
}

export async function sendNextStepsEmail(
  evaluationId: number,
  force = false
): Promise<{ sent: boolean; message: string }> {
  const { data } = await apiClient.post<{ sent: boolean; message: string }>(
    `/evaluate/${evaluationId}/send-next-steps`,
    { force }
  )
  return data
}

// ─── Candidate utilities ─────────────────────────────────────────────────────

export async function reparseCandidate(candidateId: number): Promise<{ name: string; graduation_year: number | null }> {
  const { data } = await apiClient.post<{ name: string; graduation_year: number | null }>(
    `/candidates/${candidateId}/reparse`
  )
  return data
}

export async function reparseAllCandidates(): Promise<{ updated: number; total: number }> {
  const { data } = await apiClient.post<{ updated: number; total: number }>('/candidates/reparse-all')
  return data
}

// ─── Resume Management ───────────────────────────────────────────────────────

export async function getResumes(): Promise<UploadResponse[]> {
  const { data } = await apiClient.get<UploadResponse[]>('/upload')
  return data
}

export async function deleteResume(resumeId: number): Promise<void> {
  await apiClient.delete(`/upload/${resumeId}`)
}

export async function deleteAllResumes(): Promise<{ message: string }> {
  const { data } = await apiClient.delete<{ message: string }>('/upload')
  return data
}

export async function archiveResume(resumeId: number): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(`/upload/${resumeId}/archive`)
  return data
}

export async function hardDeleteCandidate(candidateId: number): Promise<void> {
  await apiClient.delete(`/candidates/${candidateId}/permanent`)
}

export async function retryInboundEmail(emailId: number): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(`/inbound-emails/${emailId}/retry`)
  return data
}

// ─── Results ─────────────────────────────────────────────────────────────────

export async function getResults(params?: ResultsParams): Promise<PaginatedResults> {
  const { data } = await apiClient.get<PaginatedResults>('/results', { params })
  return data
}

export async function getResultDetail(evaluationId: number): Promise<EvaluationDetail> {
  const { data } = await apiClient.get<EvaluationDetail>(`/results/${evaluationId}`)
  return data
}

export interface CompareAnalysisResponse {
  analysis: string
  common_skills: string[]
  only_a: string[]
  only_b: string[]
  shared_count: number
  only_a_count: number
  only_b_count: number
  best_pick_name?: string
  score_diff?: number
  github_a?: string
  github_b?: string
}

export async function getCompareAnalysis(a: number, b: number): Promise<CompareAnalysisResponse> {
  const { data } = await apiClient.get<CompareAnalysisResponse>('/results/compare-analysis', { params: { a, b } })
  return data
}


export async function bulkDeleteResumes(resumeIds: number[]): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/upload/bulk-delete', { resume_ids: resumeIds })
  return data
}

export async function bulkArchiveResumes(resumeIds: number[]): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/upload/bulk-archive', { resume_ids: resumeIds })
  return data
}

export async function deleteResult(evaluationId: number): Promise<void> {
  await apiClient.delete(`/results/${evaluationId}`)
}

export async function deleteAllResults(jobRoleId: number): Promise<void> {
  await apiClient.delete(`/results/all?job_role_id=${jobRoleId}`)
}

// ─── Shortlist / Outcomes ────────────────────────────────────────────────────

export async function shortlistCandidate(
  evaluationId: number,
  status: ShortlistStatus,
  note?: string
): Promise<void> {
  await apiClient.post('/shortlist', { evaluation_id: evaluationId, status, note })
}

export async function recordOutcome(candidateId: number, outcome: OutcomeType): Promise<void> {
  await apiClient.post(`/candidates/${candidateId}/outcome`, { outcome })
}

export async function sendCandidateEmail(
  evaluationId: number,
  subject: string,
  body: string
): Promise<void> {
  await apiClient.post(`/results/${evaluationId}/email`, { subject, body })
}

export async function sendRejectionEmail(
  evaluationId: number,
  note?: string
): Promise<{ status: string; message: string }> {
  const { data } = await apiClient.post<{ status: string; message: string }>(
    `/results/${evaluationId}/send-rejection`,
    { note: note ?? null }
  )
  return data
}

// ─── Enrichment ──────────────────────────────────────────────────────────────

export async function getEnrichment(candidateId: number): Promise<EnrichmentData> {
  const { data } = await apiClient.get<EnrichmentData>(`/enrich/${candidateId}`)
  return data
}

export async function enrichGitHub(
  candidateId: number,
  githubUrl?: string,
  jobRoleId?: number
): Promise<EnrichmentData> {
  const { data } = await apiClient.post<EnrichmentData>(`/enrich/${candidateId}/github`, {
    github_url: githubUrl ?? null,
    job_role_id: jobRoleId ?? null,
  })
  return data
}

export async function enrichLinkedIn(
  candidateId: number,
  linkedinUrl?: string
): Promise<EnrichmentData> {
  const { data } = await apiClient.post<EnrichmentData>(`/enrich/${candidateId}/linkedin`, {
    linkedin_url: linkedinUrl ?? null,
  })
  return data
}

export async function enrichPortfolio(candidateId: number): Promise<EnrichmentData> {
  const { data } = await apiClient.post<EnrichmentData>(`/enrich/${candidateId}/portfolio`)
  return data
}

export async function setIntakePause(roleId: number, paused: boolean): Promise<JobRole> {
  const { data } = await apiClient.patch<JobRole>(`/job-roles/${roleId}/intake`, { paused })
  return data
}

// ─── Inbound Emails ──────────────────────────────────────────────────────────

export interface InboundEmailItem {
  id: number
  message_id: string
  sender_email: string | null
  subject: string | null
  received_at: string
  job_id: number | null
  job_title: string | null
  status: 'new' | 'processed' | 'failed' | 'no_attachment'
  error_message: string | null
  attachment_count: number
}

export interface PaginatedInboundEmails {
  items: InboundEmailItem[]
  total: number
  page: number
  limit: number
  pages: number
}

export interface ImapConfig {
  enabled: boolean
  method: 'imap' | 'graph' | 'none'
  host: string | null
  port: number
  poll_interval: number
  stats: {
    total: number
    processed: number
    failed: number
    no_attachment: number
  }
}

export async function getImapConfig(): Promise<ImapConfig> {
  const { data } = await apiClient.get<ImapConfig>('/inbound-emails/config')
  return data
}

export type IngestionMethod = 'disabled' | 'imap' | 'graph' | 'auto'

export async function getIngestionMethod(): Promise<{ method: IngestionMethod }> {
  const { data } = await apiClient.get<{ method: IngestionMethod }>('/admin/email-ingestion-method')
  return data
}

export async function setIngestionMethod(method: IngestionMethod): Promise<{ method: IngestionMethod; message: string }> {
  const { data } = await apiClient.post('/admin/email-ingestion-method', { method })
  return data
}

export async function getInboundEmails(params?: {
  status?: string
  search?: string
  page?: number
  limit?: number
}): Promise<PaginatedInboundEmails> {
  const { data } = await apiClient.get<PaginatedInboundEmails>('/inbound-emails', { params })
  return data
}

export async function deleteInboundEmail(emailId: number): Promise<void> {
  await apiClient.delete(`/inbound-emails/${emailId}`)
}

export async function clearInboundEmails(filterStatus?: string): Promise<{ deleted: number; message: string }> {
  const { data } = await apiClient.delete<{ deleted: number; message: string }>(
    '/inbound-emails',
    { params: filterStatus ? { status: filterStatus } : undefined }
  )
  return data
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface SkillMatchRate {
  skill_name: string
  matched_count: number
  total: number
  match_rate: number
}

export interface ScoreBucket {
  range: string
  count: number
}

export interface DailyCount {
  date: string
  count: number
}

export interface SectionAverages {
  projects: number
  skills: number
  education: number
}

export interface StageFunnelItem {
  stage: string
  label: string
  count: number
}

export interface AnalyticsData {
  total_evaluated: number
  avg_score: number
  score_distribution: ScoreBucket[]
  status_counts: Record<string, number>
  skill_match_rates: SkillMatchRate[]
  top_skill_gaps: string[]
  experience_level_counts: Record<string, number>
  avg_score_by_level: Record<string, number>
  section_averages: SectionAverages
  evaluations_per_day: DailyCount[]
  needs_review_count: number
  pending_count: number
  stage_funnel: StageFunnelItem[]
}

export async function getAnalytics(jobRoleId?: number, days = 30): Promise<AnalyticsData> {
  const params: Record<string, unknown> = { days }
  if (jobRoleId != null) params.job_role_id = jobRoleId
  const { data } = await apiClient.get<AnalyticsData>('/analytics', { params })
  return data
}

// ─── Diversity Analytics ─────────────────────────────────────────────────────

export interface ExpLevelScoreRow {
  level: string
  count: number
  avg_score: number
  shortlisted: number
  rejected: number
  hired: number
  shortlist_rate: number
}

export interface DisparateImpactRow {
  group: string
  count: number
  shortlisted: number
  shortlist_rate: number
  impact_ratio: number | null
  adverse_impact: boolean
}

export interface DisparateImpactData {
  field: string
  rows: DisparateImpactRow[]
  reference_group: string | null
  reference_rate: number
  worst_ratio: number | null
  any_adverse_impact: boolean
}

export interface DiversityData {
  total_candidates: number
  by_experience_level: ExpLevelScoreRow[]
  score_buckets_by_level: Record<string, number[]>
  stage_progression: { stage: string; label: string; count: number }[]
  location_counts: Record<string, number>
  gender_fairness: DisparateImpactData
  ethnicity_fairness: DisparateImpactData
}

export async function getDiversityAnalytics(jobRoleId?: number): Promise<DiversityData> {
  const params: Record<string, unknown> = {}
  if (jobRoleId != null) params.job_role_id = jobRoleId
  const { data } = await apiClient.get<DiversityData>('/analytics/diversity', { params })
  return data
}

export interface CalibrationBucket {
  range: string
  score_min: number
  score_max: number
  total: number
  hired: number
  rejected: number
  hire_rate: number
}

export interface ThresholdOption {
  threshold: number
  precision: number
  recall: number
  f1: number
  candidates_above: number
}

export interface CalibrationData {
  buckets: CalibrationBucket[]
  total_with_outcomes: number
  total_hired: number
  total_rejected: number
  suggested_threshold: number | null
  threshold_options: ThresholdOption[]
}

export async function getCalibration(jobRoleId?: number): Promise<CalibrationData> {
  const params: Record<string, unknown> = {}
  if (jobRoleId != null) params.job_role_id = jobRoleId
  const { data } = await apiClient.get<CalibrationData>('/analytics/calibration', { params })
  return data
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: number
  email: string
  name: string | null
  role: string
  is_active: boolean
  created_at: string
}

export async function listUsers(): Promise<AdminUser[]> {
  const { data } = await apiClient.get<AdminUser[]>('/admin/users')
  return data
}

/** Roles are given in the TT Suite: an admin here asks, a global admin approves in the portal inbox. */
export async function requestRoleChange(userId: number, role: 'recruiter' | 'admin' | null, note = ''): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>(`/admin/users/${userId}/role-request`, { role, note })
  return data
}

export async function bulkShortlist(
  evaluationIds: number[],
  status: ShortlistStatus,
  note?: string
): Promise<{ updated: number; missing: number[] }> {
  const { data } = await apiClient.post<{ updated: number; missing: number[] }>(
    '/shortlist/bulk',
    { evaluation_ids: evaluationIds, status, note }
  )
  return data
}

export async function bulkDelete(evaluationIds: number[]): Promise<{ deleted: number }> {
  if (evaluationIds.length === 0) return { deleted: 0 }
  const { data } = await apiClient.post<{ deleted: number }>('/results/bulk-delete', { ids: evaluationIds })
  return data
}

export async function autoApplyShortlist(jobRoleId: number): Promise<{ applied: number; total_qualifying: number }> {
  const { data } = await apiClient.post<{ applied: number; total_qualifying: number }>(
    `/shortlist/auto-apply?job_role_id=${jobRoleId}`
  )
  return data
}

export async function extractJdText(file: File): Promise<{ text: string; page_count: number }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await apiClient.post<{ text: string; page_count: number }>(
    '/admin/jd-extract',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return data
}

export interface SystemStatus {
  smtp_configured: boolean
  llm_configured: boolean
  llm_provider: string
  llm_model: string | null
  imap_configured: boolean
  imap_host: string | null
  secret_key_secure: boolean
  database_production_ready: boolean
  google_oauth_configured: boolean
  github_token_configured: boolean
  sharepoint_configured: boolean
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const { data } = await apiClient.get<SystemStatus>('/admin/system-status')
  return data
}

// ─── Email Templates ──────────────────────────────────────────────────────────

export interface EmailTemplateAttachment {
  id: number
  filename: string
  content_type: string
  file_size: number
  uploaded_at: string
}

export interface EmailTemplate {
  key: string
  subject: string
  body_text: string
  updated_at: string | null
  // Meeting / video link
  meeting_link: string | null
  meeting_cta_label: string | null
  generate_qr: boolean
  // CC / BCC (comma-separated, stored per template)
  cc: string | null
  bcc: string | null
  // Attached documents
  attachments: EmailTemplateAttachment[]
}

export const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  next_steps: 'Shortlist / Next Steps',
  rejection: 'Rejection',
  coding_invite: 'Coding Assessment Invite',
  interview_invite: 'Technical Interview Invite',
  github_request: 'Request GitHub Profile',
}

export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  const { data } = await apiClient.get<EmailTemplate[]>('/admin/email-templates')
  return data
}

export async function updateEmailTemplate(
  key: string,
  subject: string,
  body_text: string,
  extras?: {
    meeting_link?: string | null
    meeting_cta_label?: string | null
    generate_qr?: boolean
    cc?: string | null
    bcc?: string | null
  }
): Promise<EmailTemplate> {
  const { data } = await apiClient.put<EmailTemplate>(`/admin/email-templates/${key}`, {
    subject,
    body_text,
    meeting_link: extras?.meeting_link ?? null,
    meeting_cta_label: extras?.meeting_cta_label ?? 'Join Meeting',
    generate_qr: extras?.generate_qr ?? false,
    cc: extras?.cc ?? null,
    bcc: extras?.bcc ?? null,
  })
  return data
}

export async function resetEmailTemplate(key: string): Promise<EmailTemplate> {
  const { data } = await apiClient.delete<EmailTemplate>(`/admin/email-templates/${key}/reset`)
  return data
}

export async function deleteEmailTemplate(key: string): Promise<void> {
  await apiClient.delete(`/admin/email-templates/${key}`)
}

export async function uploadEmailTemplateAttachment(
  key: string,
  file: File
): Promise<EmailTemplateAttachment> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await apiClient.post<EmailTemplateAttachment>(
    `/admin/email-templates/${key}/attachments`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return data
}

export async function deleteEmailTemplateAttachment(
  key: string,
  attachmentId: number
): Promise<void> {
  await apiClient.delete(`/admin/email-templates/${key}/attachments/${attachmentId}`)
}

export function getEmailTemplateAttachmentDownloadUrl(key: string, attachmentId: number): string {
  return `/api/admin/email-templates/${key}/attachments/${attachmentId}/download`
}

// ─── Directory Sync (AD / LDAP) ──────────────────────────────────────────────

export interface DirectorySyncSettings {
  directory_sync_source: 'azure_ad' | 'ldap'
  ldap_host: string
  ldap_port: number
  ldap_use_ssl: boolean
  ldap_bind_dn: string
  ldap_bind_password_set: boolean
  ldap_base_dn: string
  ldap_user_filter: string
  ldap_email_attr: string
  ldap_name_attr: string
  ldap_title_attr: string
  ldap_dept_attr: string
  last_synced_at: string | null
  last_synced_count: number
  employee_count: number
  graph_configured: boolean
}

export async function getDirectorySyncSettings(): Promise<DirectorySyncSettings> {
  const { data } = await apiClient.get('/admin/directory-sync/settings')
  return data
}

export async function saveDirectorySyncSettings(payload: Partial<DirectorySyncSettings> & { ldap_bind_password?: string }): Promise<void> {
  await apiClient.post('/admin/directory-sync/settings', payload)
}

export async function triggerDirectorySync(): Promise<{ synced: number; source: string }> {
  const { data } = await apiClient.post('/admin/directory-sync/sync')
  return data
}

export async function clearDirectoryEmployees(): Promise<void> {
  await apiClient.delete('/admin/directory-sync/employees')
}

// ─── Custom email composer ────────────────────────────────────────────────────

export interface EmployeeEmail {
  id: string
  email: string
  name: string | null
  type: 'user' | 'candidate'
}

export async function getEmployeeEmails(): Promise<EmployeeEmail[]> {
  const { data } = await apiClient.get('/results/employee-emails')
  return data
}

export async function sendCustomEmailToCandidate(
  evaluationId: number,
  subject: string,
  body: string,
  meetingLink?: string,
  meetingCtaLabel?: string,
  generateQr?: boolean,
  files?: File[],
  cc?: string[],
  bcc?: string[],
): Promise<{ status: string; message: string }> {
  const form = new FormData()
  form.append('subject', subject)
  form.append('body', body)
  if (meetingLink) form.append('meeting_link', meetingLink)
  if (meetingCtaLabel) form.append('meeting_cta_label', meetingCtaLabel)
  form.append('generate_qr', String(generateQr ?? false))
  if (files) files.forEach((f) => form.append('files', f))
  if (cc && cc.length) form.append('cc', cc.join(','))
  if (bcc && bcc.length) form.append('bcc', bcc.join(','))
  const { data } = await apiClient.post(`/results/${evaluationId}/email`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function bulkSendNextSteps(
  jobRoleId: number
): Promise<{ sent: number; skipped: number; errors: number; message: string }> {
  const { data } = await apiClient.post<{ sent: number; skipped: number; errors: number; message: string }>(
    `/evaluate/bulk-send-next-steps?job_role_id=${jobRoleId}`
  )
  return data
}

export type CandidateStage = 'applied' | 'screening' | 'coding' | 'interview' | 'offer' | 'hired' | 'rejected'

export async function updateEvaluationStage(
  evaluationId: number,
  stage: CandidateStage
): Promise<{ evaluation_id: number; stage: CandidateStage }> {
  const { data } = await apiClient.patch<{ evaluation_id: number; stage: CandidateStage }>(
    `/results/evaluations/${evaluationId}/stage`,
    { stage }
  )
  return data
}

export async function bulkUpdateStage(
  evaluationIds: number[],
  stage: CandidateStage
): Promise<{ updated: number; stage: CandidateStage }> {
  const { data } = await apiClient.post<{ updated: number; stage: CandidateStage }>(
    '/results/bulk-stage',
    { evaluation_ids: evaluationIds, stage }
  )
  return data
}

export interface ImapSettings {
  imap_host: string
  imap_port: number
  imap_username: string
  imap_password_set: boolean
  imap_ssl: boolean
  imap_folder: string
  imap_subject_keywords: string
  imap_fetch_from_date: string
  imap_fetch_to_date: string
  configured: boolean
}

export async function getImapSettings(): Promise<ImapSettings> {
  const { data } = await apiClient.get<ImapSettings>('/admin/imap-settings')
  return data
}

export async function saveImapSettings(payload: {
  imap_host: string
  imap_port: number
  imap_username: string
  imap_password: string
  imap_ssl: boolean
  imap_folder: string
  imap_subject_keywords: string
  imap_fetch_from_date: string
  imap_fetch_to_date: string
}): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/imap-settings', payload)
  return data
}

export async function testImapConnection(): Promise<{ ok: boolean; message?: string; error?: string }> {
  const { data } = await apiClient.post<{ ok: boolean; message?: string; error?: string }>('/admin/test-imap')
  return data
}

export async function testSmtpConnection(): Promise<{ ok: boolean; message?: string; error?: string }> {
  const { data } = await apiClient.post<{ ok: boolean; message?: string; error?: string }>('/admin/test-smtp')
  return data
}

// ─── Microsoft Graph API Settings ────────────────────────────────────────────

export interface GraphSettings {
  graph_client_id: string
  graph_tenant_id: string
  graph_client_secret_set: boolean
  graph_mailbox: string
  graph_folder: string
  graph_subject_keywords: string
  graph_fetch_from_date: string
  graph_fetch_to_date: string
  configured: boolean
}

export async function getGraphSettings(): Promise<GraphSettings> {
  const { data } = await apiClient.get<GraphSettings>('/admin/graph-settings')
  return data
}

export async function saveGraphSettings(payload: {
  graph_client_id: string
  graph_tenant_id: string
  graph_client_secret: string
  graph_mailbox: string
  graph_folder: string
  graph_subject_keywords: string
  graph_fetch_from_date: string
  graph_fetch_to_date: string
}): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/graph-settings', payload)
  return data
}

export async function testGraphConnection(): Promise<{ ok: boolean; message?: string; error?: string }> {
  const { data } = await apiClient.post<{ ok: boolean; message?: string; error?: string }>('/admin/test-graph')
  return data
}

export async function triggerGraphFetch(fromDate?: string, toDate?: string): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/trigger-graph-fetch', {
    from_date: fromDate ?? '',
    to_date: toDate ?? '',
    tz_offset_minutes: new Date().getTimezoneOffset(),
  })
  return data
}

export async function stopGraphFetch(): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/stop-graph-fetch')
  return data
}

export async function triggerImapFetch(fromDate?: string, toDate?: string): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/trigger-imap-fetch', {
    from_date: fromDate ?? '',
    to_date: toDate ?? '',
    tz_offset_minutes: new Date().getTimezoneOffset(),
  })
  return data
}

export async function stopImapFetch(): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/stop-imap-fetch')
  return data
}

export async function getGraphFetchStatus(): Promise<{ running: boolean }> {
  const { data } = await apiClient.get<{ running: boolean }>('/admin/graph-fetch-status')
  return data
}

export async function getImapFetchStatus(): Promise<{ running: boolean }> {
  const { data } = await apiClient.get<{ running: boolean }>('/admin/imap-fetch-status')
  return data
}

export async function reclassifyExperienceLevels(): Promise<{ updated: number; total: number }> {
  const { data } = await apiClient.post<{ updated: number; total: number }>('/admin/reclassify-experience-levels')
  return data
}

// ─── Candidate Search ─────────────────────────────────────────────────────────

export interface CandidateSearchItem {
  id: number
  name: string
  email: string | null
  phone: string | null
  current_title: string | null
  experience_level: string | null
  years_experience: number | null
  stage: string
  source: string | null
  linkedin_url: string | null
  github_url: string | null
  portfolio_url: string | null
  latest_job_role: string | null
  latest_evaluation_id: number | null
  tags: string[]
}

export interface PaginatedCandidates {
  items: CandidateSearchItem[]
  total: number
  page: number
  limit: number
  pages: number
}

// ─── Interview Feedback ───────────────────────────────────────────────────────

export interface InterviewFeedback {
  id: number
  candidate_id: number
  evaluation_id: number | null
  interviewer_email: string | null
  stage: string
  rating: number
  technical_score: number | null
  communication_score: number | null
  culture_fit_score: number | null
  recommendation: string | null
  notes: string | null
  created_at: string
}

export interface FeedbackCreate {
  candidate_id: number
  evaluation_id?: number | null
  stage: 'screening' | 'coding' | 'interview'
  rating: number
  technical_score?: number | null
  communication_score?: number | null
  culture_fit_score?: number | null
  recommendation?: string | null
  notes?: string | null
}

export async function getFeedbackForCandidate(candidateId: number): Promise<InterviewFeedback[]> {
  const { data } = await apiClient.get<InterviewFeedback[]>(`/interview-feedback/candidate/${candidateId}`)
  return data
}

export async function createFeedback(body: FeedbackCreate): Promise<InterviewFeedback> {
  const { data } = await apiClient.post<InterviewFeedback>('/interview-feedback', body)
  return data
}

export async function deleteFeedback(feedbackId: number): Promise<void> {
  await apiClient.delete(`/interview-feedback/${feedbackId}`)
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

export async function downloadResultsCsv(
  jobRoleId?: number | null,
  status?: string,
  search?: string,
): Promise<void> {
  const { data } = await apiClient.get('/results/export/csv', {
    params: {
      ...(jobRoleId != null ? { job_role_id: jobRoleId } : {}),
      ...(status ? { status } : {}),
      ...(search ? { search } : {}),
    },
    responseType: 'blob',
  })
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `candidates_export_${jobRoleId ?? 'all'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Bulk CSV / Excel Import ──────────────────────────────────────────────────

export interface BulkImportResult {
  created: number
  updated: number
  errors: string[]
}

export async function bulkImportCandidates(file: File): Promise<BulkImportResult> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await apiClient.post<BulkImportResult>('/upload/bulk-import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

// ─── Candidate Search ─────────────────────────────────────────────────────────

export async function searchCandidates(params: {
  q?: string
  stage?: string
  experience_level?: string
  page?: number
  limit?: number
}): Promise<PaginatedCandidates> {
  const { data } = await apiClient.get<PaginatedCandidates>('/candidates/search', { params })
  return data
}

export interface SemanticSearchHit {
  candidate_id: number
  name: string
  email?: string
  current_title?: string
  experience_level?: string
  location?: string
  similarity: number
  snippet: string
  latest_evaluation_id?: number
}

export async function semanticSearchCandidates(query: string, limit = 20): Promise<SemanticSearchHit[]> {
  const { data } = await apiClient.post<SemanticSearchHit[]>('/candidates/semantic-search', { query, limit })
  return data
}

export interface CandidateUpdate {
  name?: string
  email?: string
  phone?: string
  current_title?: string
  experience_level?: string
  years_experience?: number | null
  linkedin_url?: string | null
  github_url?: string | null
  portfolio_url?: string | null
  stage?: string
  tags?: string[]
}

export async function updateCandidate(candidateId: number, data: CandidateUpdate): Promise<CandidateSearchItem> {
  const { data: res } = await apiClient.patch<CandidateSearchItem>(`/candidates/${candidateId}`, data)
  return res
}

export async function deleteCandidate(candidateId: number): Promise<void> {
  await apiClient.delete(`/candidates/${candidateId}`)
}

export async function bulkDeleteCandidates(ids: number[]): Promise<{ deleted: number }> {
  const { data } = await apiClient.post<{ deleted: number }>('/candidates/bulk-delete', { ids })
  return data
}

// ─── Candidate Comments ───────────────────────────────────────────────────────

export interface CandidateComment {
  id: number
  candidate_id: number
  author_id: number | null
  author_email: string | null
  parent_id: number | null
  body: string
  created_at: string
  updated_at: string | null
}

export async function getComments(candidateId: number): Promise<CandidateComment[]> {
  const { data } = await apiClient.get<CandidateComment[]>(`/candidates/${candidateId}/comments`)
  return data
}

export async function createComment(candidateId: number, body: string, parentId?: number | null): Promise<CandidateComment> {
  const { data } = await apiClient.post<CandidateComment>(`/candidates/${candidateId}/comments`, { body, parent_id: parentId ?? null })
  return data
}

export async function updateComment(candidateId: number, commentId: number, body: string): Promise<CandidateComment> {
  const { data } = await apiClient.patch<CandidateComment>(`/candidates/${candidateId}/comments/${commentId}`, { body })
  return data
}

export async function deleteComment(candidateId: number, commentId: number): Promise<void> {
  await apiClient.delete(`/candidates/${candidateId}/comments/${commentId}`)
}

// ─── Notifications ────────────────────────────────────────────────────────────

export interface AppNotification {
  id: number
  type: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export interface NotificationListResponse {
  items: AppNotification[]
  total: number
  page: number
  page_size: number
}

export async function getNotifications(params?: { unread_only?: boolean; page?: number; page_size?: number }): Promise<NotificationListResponse> {
  const { data } = await apiClient.get<NotificationListResponse>('/notifications', { params })
  return data
}

export async function getUnreadNotificationCount(): Promise<number> {
  const { data } = await apiClient.get<{ count: number }>('/notifications/unread-count')
  return data.count
}

export async function markNotificationRead(id: number): Promise<AppNotification> {
  const { data } = await apiClient.patch<AppNotification>(`/notifications/${id}/read`)
  return data
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.post('/notifications/mark-all-read')
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface ReportSchema {
  dimensions: { key: string; label: string }[]
  metrics: { key: string; label: string }[]
  filters: { key: string; label: string; type: string }[]
}

export interface ReportConfig {
  dimensions: string[]
  metrics: string[]
  filters: Record<string, unknown>
}

export interface ReportRow {
  dimensions: Record<string, string>
  metrics: Record<string, number>
}

export interface ReportRunResult {
  rows: ReportRow[]
}

export interface SavedReport {
  id: number
  owner_id: number
  name: string
  config: ReportConfig
  created_at: string
  updated_at: string | null
  share_token: string | null
  is_shared: boolean
}

export interface ReportDrilldownCandidate {
  evaluation_id: number
  candidate_id: number
  candidate_name: string
  candidate_email: string | null
  candidate_phone: string | null
  job_role_id: number
  job_role_title: string | null
  current_title: string | null
  experience_level: string | null
  years_experience: number | null
  location: string | null
  stage: string
  total_score: number
  skills_matched: number
  skills_total: number
  matched_skill_names: string[]
  evaluated_at: string | null
  reasoning_summary: string | null
}

export interface ReportDrilldownRequest extends ReportConfig {
  dimension_values: Record<string, string>
  limit?: number
  offset?: number
}

export interface ReportDrilldownResult {
  candidates: ReportDrilldownCandidate[]
  total: number
}

export async function getReportSchema(): Promise<ReportSchema> {
  const { data } = await apiClient.get<ReportSchema>('/reports/schema')
  return data
}

export async function runReport(config: ReportConfig): Promise<ReportRunResult> {
  const { data } = await apiClient.post<ReportRunResult>('/reports/run', config)
  return data
}

export async function runReportDrilldown(body: ReportDrilldownRequest): Promise<ReportDrilldownResult> {
  const { data } = await apiClient.post<ReportDrilldownResult>('/reports/drilldown', body)
  return data
}

export async function listSavedReports(): Promise<SavedReport[]> {
  const { data } = await apiClient.get<SavedReport[]>('/reports')
  return data
}

export async function createSavedReport(name: string, config: ReportConfig): Promise<SavedReport> {
  const { data } = await apiClient.post<SavedReport>('/reports', { name, config })
  return data
}

export async function updateSavedReport(id: number, name: string, config: ReportConfig): Promise<SavedReport> {
  const { data } = await apiClient.patch<SavedReport>(`/reports/${id}`, { name, config })
  return data
}

export async function deleteSavedReport(id: number): Promise<void> {
  await apiClient.delete(`/reports/${id}`)
}

export async function shareSavedReport(id: number): Promise<SavedReport> {
  const { data } = await apiClient.post<SavedReport>(`/reports/${id}/share`)
  return data
}

export async function unshareSavedReport(id: number): Promise<SavedReport> {
  const { data } = await apiClient.delete<SavedReport>(`/reports/${id}/share`)
  return data
}

export interface SharedReportView {
  name: string
  config: ReportConfig
  result: ReportRunResult
  candidates: ReportDrilldownCandidate[]
}

export async function getSharedReport(token: string): Promise<SharedReportView> {
  const { data } = await axios.get<SharedReportView>(`${API_BASE_URL}/reports/view/${token}`)
  return data
}

export async function downloadReportPdf(reportId: number | null, config: ReportConfig, reportName?: string): Promise<void> {
  const { data } = reportId != null
    ? await apiClient.get(`/reports/${reportId}/pdf`, { responseType: 'blob' })
    : await apiClient.post('/reports/pdf', config, { responseType: 'blob' })
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${(reportName ?? 'report').replace(/[^a-z0-9_-]+/gi, '_')}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadReportCandidatesCsv(reportId: number | null, config: ReportConfig, reportName?: string): Promise<void> {
  const { data } = reportId != null
    ? await apiClient.get(`/reports/${reportId}/csv`, { responseType: 'blob' })
    : await apiClient.post('/reports/candidates/csv', config, { responseType: 'blob' })
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${(reportName ?? 'report').replace(/[^a-z0-9_-]+/gi, '_')}_candidates.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Resume Full-text Search ──────────────────────────────────────────────────

export interface ResumeSearchHit {
  evaluation_id: number
  candidate_id: number
  candidate_name: string
  candidate_email: string | null
  job_role_title: string
  total_score: number
  snippet: string
}

export interface ResumeSearchResponse {
  hits: ResumeSearchHit[]
  total: number
}

export async function searchResumes(params: {
  q: string
  job_role_id?: number
  page?: number
  limit?: number
}): Promise<ResumeSearchResponse> {
  const { data } = await apiClient.get<ResumeSearchResponse>('/results/search', { params })
  return data
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: number
  user_id: number | null
  user_email: string | null
  action: string
  target_type: string | null
  target_id: number | null
  details: Record<string, any> | null
  timestamp: string
}

export interface PaginatedAuditLog {
  items: AuditLogEntry[]
  total: number
  page: number
  limit: number
  pages: number
}

export async function getAuditLog(params: {
  target_type?: string
  target_id?: number
  action?: string
  page?: number
  limit?: number
}): Promise<PaginatedAuditLog> {
  const { data } = await apiClient.get<PaginatedAuditLog>('/audit-log', { params })
  return data
}

// ─── Manual Evaluation ────────────────────────────────────────────────────────

export interface ManualEvaluationPayload {
  manual_score: number
  justification?: string | null
  skills_checklist?: Record<string, boolean> | null
}

export interface ManualEvaluation {
  id: number
  evaluation_id: number
  recruiter_id: number | null
  manual_score: number
  justification: string | null
  skills_checklist: Record<string, boolean> | null
  created_at: string
  updated_at: string | null
}

export async function postManualEvaluation(
  evaluationId: number,
  payload: ManualEvaluationPayload
): Promise<ManualEvaluation> {
  const { data } = await apiClient.post<ManualEvaluation>(
    `/resumes/${evaluationId}/manual-evaluation`,
    payload
  )
  return data
}

export async function getManualEvaluation(evaluationId: number): Promise<ManualEvaluation> {
  const { data } = await apiClient.get<ManualEvaluation>(`/resumes/${evaluationId}/manual-evaluation`)
  return data
}

// ─── SharePoint Config ────────────────────────────────────────────────────────

export interface SharePointConfig {
  site_url: string | null
  list_name: string | null
  status_column: string
  enabled: boolean
  fetch_folder_id: string | null
  fetch_folder_name: string | null
  export_folder_id: string | null
  export_folder_name: string | null
}

export async function getSharePointConfig(): Promise<SharePointConfig> {
  const { data } = await apiClient.get<SharePointConfig>('/admin/sharepoint/config')
  return data
}

export async function saveSharePointConfig(config: SharePointConfig): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/sharepoint/connect', config)
  return data
}

export async function createSharePointFolder(
  folderName: string,
  purpose: 'fetch' | 'export'
): Promise<{ folder_id: string; folder_name: string; web_url: string | null; purpose: string }> {
  const { data } = await apiClient.post('/admin/sharepoint/create-folder', { folder_name: folderName, purpose })
  return data
}

export async function triggerSharePointFetch(): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/sharepoint/trigger-fetch')
  return data
}

export async function stopSharePointFetch(): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/sharepoint/stop-fetch')
  return data
}

export async function getSharePointFetchStatus(): Promise<{ running: boolean }> {
  const { data } = await apiClient.get<{ running: boolean }>('/admin/sharepoint/fetch-status')
  return data
}

export async function exportResultsToSharePoint(params: {
  job_role_id?: number
  status?: string
  search?: string
  format?: 'pdf' | 'csv' | 'xlsx'
}): Promise<{ message: string; filename: string; web_url: string | null }> {
  const { data } = await apiClient.post('/admin/sharepoint/export-results', params)
  return data
}

// ─── OneDrive Config ──────────────────────────────────────────────────────────

export interface OneDriveConfig {
  folder_id: string | null
  folder_name: string | null
  poll_interval_minutes: number
  enabled: boolean
}

export async function getOneDriveConfig(): Promise<OneDriveConfig> {
  const { data } = await apiClient.get<OneDriveConfig>('/admin/onedrive/config')
  return data
}

export async function saveOneDriveConfig(config: OneDriveConfig): Promise<{ message: string }> {
  const { data } = await apiClient.post<{ message: string }>('/admin/onedrive/config', config)
  return data
}

// ─── GDPR / Data Retention ────────────────────────────────────────────────────

export interface DataRetentionSettings {
  retention_enabled: boolean
  retention_days: number
  retain_hired_forever: boolean
  anonymize_on_delete: boolean
  auto_delete_evaluations: boolean
}

export interface RetentionRunResult {
  candidates_processed: number
  candidates_anonymized: number
  candidates_deleted: number
  evaluations_deleted: number
  errors: number
}

export async function getGdprSettings(): Promise<DataRetentionSettings> {
  const { data } = await apiClient.get<DataRetentionSettings>('/admin/gdpr/settings')
  return data
}

export async function updateGdprSettings(payload: DataRetentionSettings): Promise<DataRetentionSettings> {
  const { data } = await apiClient.put<DataRetentionSettings>('/admin/gdpr/settings', payload)
  return data
}

export async function runRetention(dryRun = true): Promise<RetentionRunResult> {
  const { data } = await apiClient.post<RetentionRunResult>(`/admin/gdpr/run-retention?dry_run=${dryRun}`)
  return data
}

export async function fetchResumeFileBlob(resumeId: number): Promise<Blob> {
  const res = await fetch(`${API_BASE_URL}/upload/${resumeId}/file`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

// ─── Share Links ──────────────────────────────────────────────────────────────

export interface ShareLinkOut {
  id: number
  token: string
  job_role_id: number | null
  label: string | null
  recipient_name: string | null
  created_at: string
  expires_at: string | null
  is_active: boolean
  candidate_count: number
  stages?: string[] | null
}

export interface ShareCandidateOut {
  evaluation_id: number
  candidate_id: number
  candidate_name: string
  current_title: string | null
  experience_level: string | null
  years_experience: number | null
  location: string | null
  total_score: number
  project_score: number
  skill_score: number
  education_score: number
  skills_matched: number
  skills_total: number
  matched_skill_names: string[]
  status: string | null
  reasoning_summary: string | null
  upvotes: number
  downvotes: number
  my_vote: string | null
}

export interface ShareViewOut {
  token: string
  label: string | null
  recipient_name: string | null
  job_role_title: string
  created_at: string
  expires_at: string | null
  candidates: ShareCandidateOut[]
}

export async function createShareLink(payload: {
  job_role_id: number
  evaluation_ids?: number[]
  stages?: string[]
  label?: string
  recipient_name?: string
  expires_in_days?: number
}): Promise<ShareLinkOut> {
  const { data } = await apiClient.post<ShareLinkOut>('/share', payload)
  return data
}

export async function listShareLinks(jobRoleId?: number): Promise<ShareLinkOut[]> {
  const params = jobRoleId != null ? { job_role_id: jobRoleId } : {}
  const { data } = await apiClient.get<ShareLinkOut[]>('/share', { params })
  return data
}

export async function deactivateShareLink(id: number): Promise<void> {
  await apiClient.delete(`/share/${id}`)
}

export async function getShareView(token: string, voterToken?: string): Promise<ShareViewOut> {
  const params = voterToken ? { voter_token: voterToken } : {}
  const { data } = await axios.get<ShareViewOut>(`${API_BASE_URL}/share/view/${token}`, { params })
  return data
}

export async function submitShareVote(token: string, payload: {
  evaluation_id: number
  vote: 'up' | 'down' | 'clear'
  voter_token: string
  comment?: string
}): Promise<void> {
  await axios.post(`${API_BASE_URL}/share/view/${token}/vote`, payload, { headers: { 'X-Requested-With': 'XHR' } })
}

export default apiClient
