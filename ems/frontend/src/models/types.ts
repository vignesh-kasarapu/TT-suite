// Shapes returned by the API (mirror backend/app/schemas).

export type Role = "APPROVER" | "FINANCE" | "ADMIN";
export type Preset = "linen" | "harbour" | "graphite";
export type Mode = "system" | "light" | "dark";

/** TT Suite apps and the portal's GET /api/me (camelCase). */
export type SuiteApp = "kanban" | "lms" | "expense" | "ams";
export interface SuitePreferences { preset: Preset; mode: Mode }
export interface SuiteMe {
  id: string;
  email: string;
  name: string;
  isGlobalAdmin: boolean;
  photoUrl: string | null;
  access: Partial<Record<SuiteApp, string | null>>;
  preferences: SuitePreferences;
  /** Unread messages in the portal inbox (/inbox). */
  unreadCount?: number;
}

export interface Me {
  id: number;
  email: string;
  full_name: string;
  employee_code: string;
  department: string;
  location: string;
  manager_id: number | null;
  roles: Role[];
  phone: string;
  designation: string;
  manager_name: string | null;
  bank_account_holder: string;
  bank_account_no_masked: string;
  bank_ifsc: string;
  bank_upi: string;
  bank_change_pending: boolean;
  notify_prefs: Partial<Record<NotifyKind, boolean>>;
  can_request_advance: boolean;
  is_level2_approver: boolean;
}

export type NotifyKind = "APPROVED" | "RETURNED" | "PAID" | "COMMENT";

export interface UserBrief {
  id: number;
  full_name: string;
  employee_code: string;
  department: string;
  roles: Role[];
}

export interface UserLookup {
  id: number;
  full_name: string;
  employee_code: string;
  roles: Role[];
}

export interface Flag {
  action: "BLOCK" | "FLAG" | "WARN";
  message: string;
  type?: string;
  other_claim_no?: string;
  other_employee?: string;
  other_date?: string;
  other_amount?: string;
  other_merchant?: string;
  other_status?: string;
}

export interface LineInput {
  id?: number | null;
  category_id: number;
  expense_date: string;
  merchant: string;
  description: string;
  amount: number;
  cost_centre: string;
  state: string;
  invoice_no: string;
  supplier_gstin: string;
  buyer_gstin: string;
  cgst: number;
  sgst: number;
  igst: number;
  extra_field_value: string;
  justification: string;
  receipt_path: string | null;
  receipt_name: string | null;
}


export interface Line extends LineInput {
  id: number;
  category_name: string;
  approved_amount: number | null;
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
  reject_reason: string | null;
  gst_credit_eligible: boolean | null;
  policy_flags: Flag[];
  duplicate_flags: Flag[];
  duplicate_cleared_reason: string | null;
}

export type Level = "L1" | "L2" | "FINANCE";

export interface Step {
  id: number;
  line_id: number | null;
  round: number;
  level: Level;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED" | "SENT_BACK" | "CANCELLED";
  approver_name: string | null;
  current_approver_name: string | null;
  amount: number | null;
  approved_amount: number | null;
  acted_by_name: string | null;
  on_behalf_of_name: string | null;
  acted_at: string | null;
  comment: string | null;
  self_approved: boolean;
  escalated: boolean;
  activated_at: string;
}

export type ClaimStatus =
  | "PENDING_APPROVAL" | "PENDING_FINANCE" | "READY_FOR_PAYROLL" | "SENT_TO_PAYROLL"
  | "PAID" | "PAYMENT_FAILED" | "REJECTED" | "SENT_BACK" | "WITHDRAWN";

export interface ClaimSummary {
  id: number;
  claim_no: string | null;
  type: "EXPENSE" | "ADVANCE";
  title: string;
  project: string;
  purpose: string;
  status: ClaimStatus;
  employee: UserBrief;
  line_count: number;
  stage: string;
  waiting_on: string;
  stage_since: string;
  submitted_at: string | null;
  self_approved: boolean;
  total_claimed: number;
  total_approved: number | null;
  payout_amount: number | null;
  payment_month: string | null;
  advance_balance: number | null;
  advance_status: string | null;
  updated_at: string;
}

export interface ClaimDetail extends ClaimSummary {
  round: number;
  return_reason: string | null;
  finance_approved_at: string | null;
  advance_deducted: number;
  paid_at: string | null;
  failure_reason: string | null;
  expected_settlement_date: string | null;
  lines: Line[];
  steps: Step[];
  waiting_on_steps: string[];
  comments: Comment[];
  can_withdraw: boolean;
  my_step_ids: number[];
  can_edit: boolean;
  can_finance_act: boolean;
  can_reassign: boolean;
}

export interface Comment {
  id: number;
  author_id: number;
  author_name: string;
  body: string;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  kind: "EXPENSE" | "ADVANCE";
  group_name: string;
  description: string | null;
  gl_code: string;
  gst_credit_eligible: boolean;
  taxable: boolean;
  receipt_required: boolean;
  receipt_threshold: number | null;
  extra_field_label: string | null;
  is_active: boolean;
}

export interface InboxItem {
  step_id: number;
  level: Level;
  claim_id: number;
  claim_no: string | null;
  claim_type: "EXPENSE" | "ADVANCE";
  title: string;
  employee: UserBrief;
  line_id: number | null;
  category_name: string | null;
  expense_date: string | null;
  merchant: string | null;
  amount: number | null;
  flags: string[];
  self_approved: boolean;
  on_behalf_of: string | null;
  next_step: string;
  prev_approval: string | null;
  prev_approved_at: string | null;
  line_count: number;
  waiting_since: string;
}

export interface Delegation {
  id: number;
  delegator: UserBrief;
  delegate: UserBrief;
  start_date: string;
  end_date: string;
  reason: string;
  cancelled_at: string | null;
  is_active_now: boolean;
}

export interface Notification {
  id: number;
  message: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

export interface BatchPreview {
  month: string;
  claims: ClaimSummary[];
  claim_count: number;
  total_amount: number;
  recoveries: ClaimSummary[];
  recovery_total: number;
}

export interface Batch {
  id: number;
  month: string;
  created_at: string;
  claim_count: number;
  total_amount: number;
  recovery_total: number;
}

export interface AdvanceRow {
  claim: ClaimSummary;
  due_date: string | null;
  overdue: boolean;
}

export interface AdminUser {
  id: number;
  email: string;
  full_name: string;
  employee_code: string;
  department: string;
  location: string;
  manager_id: number | null;
  phone: string;
  designation: string;
  roles: Role[];
  is_active: boolean;
}

/** Expense roles in the TT Suite (granted by the global admin in the portal). */
export type SuiteRole = "member" | "approver" | "finance" | "admin";

/** An open request to the global admin to change someone's Expense role (role null = remove access). */
export interface RoleRequest {
  id: number;
  email: string;
  role: SuiteRole | null;
  requested_at: string;
  requested_by: string | null;
}

export interface Limit {
  id?: number;
  category_id: number;
  scope: "EMPLOYEE" | "DEPARTMENT" | "COMPANY";
  scope_value: string | null;
  period: "LINE" | "DAY" | "MONTH" | "YEAR";
  amount: number;
  action: "BLOCK" | "FLAG" | "WARN";
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
}

export interface Settings {
  reminder_days: number;
  escalation_days: number;
  payroll_cutoff_day: number;
  self_approval_cap: number | null;
  finance_backup_reviewer_id: number | null;
  finance_second_reviewer_id: number | null;
  advance_max_amount: number;
  advance_settle_days: number;
  duplicate_window_days: number;
  late_submission_days: number;
  require_project: boolean;
  require_purpose: boolean;
  projects: string[];
  cost_centres: string[];
  departments: string[];
  fallback_approver_id: number | null;
  level2_above: number;
  level2_approver_id: number | null;
  bank_change_needs_verification: boolean;
  company_gstins: Record<string, string>;
}

export interface Lists {
  projects: string[];
  cost_centres: string[];
  departments: string[];
  require_project: boolean;
  require_purpose: boolean;
  late_submission_days: number;
}

export interface BankChange {
  user_id: number;
  full_name: string;
  employee_code: string;
  current: Record<string, string>;
  requested: Record<string, string>;
}

export interface PolicyOverview {
  late_submission_days: number;
  level2_above: number;
  categories: {
    id: number;
    group: string;
    name: string;
    description: string | null;
    limits: { text: string; applies_to: string; over_limit: string }[];
    receipt: string;
    extra_field: string | null;
  }[];
}

export interface AuditRow {
  id: number;
  at: string;
  actor_name: string | null;
  on_behalf_of_name: string | null;
  action: string;
  entity: string;
  entity_id: string;
  claim_id: number | null;
  claim_no: string | null;
  level: string | null;
  amount: number | null;
  self_approved: boolean;
  details: Record<string, unknown>;
}

export interface KeyAmount {
  key: string;
  amount: number;
  count?: number;
}

export interface Dashboard {
  total_spend: number;
  by_month: KeyAmount[];
  by_category: KeyAmount[];
  by_department: KeyAmount[];
  by_location: KeyAmount[];
  pending_by_level: Partial<Record<Level, number>>;
  avg_hours_by_level: Partial<Record<Level, number>>;
  level2_by_category: KeyAmount[];
  self_approved: { person: string; month: string; count: number; amount: number }[];
  policy_violations: Partial<Record<"BLOCK" | "FLAG" | "WARN", number>>;
  gst: { eligible: number; not_eligible: number };
}
