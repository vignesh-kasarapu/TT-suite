/** Mirrors backend-py's Pydantic schemas field-for-field — see
 * backend-py/app/schemas/{employee,leave_request,ledger,notification_centre}.py.
 * Only the fields Tier 1 screens actually use are included here; add more as
 * later screens need them rather than speculatively mirroring everything. */

export type LeaveRequestState =
  | 'DRAFT'
  | 'PENDING_MANAGER'
  | 'PENDING_HR'
  | 'APPROVED'
  | 'REJECTED'
  | 'REJECTED_PENDING_WITHDRAWAL'
  | 'WITHDRAWN'
  | 'LOP_APPLIED'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLED';

export interface LeaveYear {
  leave_year_id: number;
  year_code: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  is_closed: boolean;
}

export interface LeaveType {
  leave_type_id: number;
  type_code: string;
  type_name: string;
  is_sick_leave: boolean;
  is_balance_affecting: boolean;
  is_system: boolean;
  is_selectable_by_employee: boolean;
  permits_half_day: boolean;
  permits_attachments: boolean;
}

/** GET /api/employees/dashboard hand-builds this camelCase, with the full
 * LeaveType model nested (still snake_case inside) — matches Node's
 * getDashboard exactly, not a flattened id/name/code trio. See
 * backend-py/app/schemas/employee.py's DashboardBalanceCardOut. */
export interface DashboardBalanceCard {
  leaveType: LeaveType;
  ledgerBalance: number;
  committedToOpenRequests: number;
  effectiveBalance: number;
}

export interface LeaveRequest {
  request_id: number;
  employee_id: number;
  leave_type_id: number;
  leave_year_id: number;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  half_day_portion: string | null;
  reason: string;
  state: LeaveRequestState;
  deducted_days: number | null;
  is_advance_leave: boolean;
  is_long_leave: boolean;
  current_approver_id: number | null;
}

/** GET /api/employees/dashboard — Node hand-builds { balances, pending,
 * upcoming, withdrawalWindow, leaveYear }, different key names from what the
 * backend calls these internally, not just different casing. See
 * backend-py/app/schemas/employee.py's DashboardOut. */
export interface Dashboard {
  balances: DashboardBalanceCard[];
  pending: LeaveRequest[];
  upcoming: LeaveRequest[];
  withdrawalWindow: LeaveRequest[];
  leaveYear: LeaveYear;
}

/** GET /api/leave-requests/preview's per-day breakdown — entirely hand-built
 * in Node's computeDeductionBreakdown, camelCase. */
export interface DayBreakdown {
  date: string;
  weekdayCode: string;
  isWeekend: boolean;
  isHoliday: boolean;
  deducted: boolean;
  excludedReason: string | null;
}

/** GET /api/leave-requests/preview — the single most heavily camelCase
 * response in the backend (Node flattens two hand-built sub-objects plus 3
 * more keys). leaveYear is the one real nested model, snake_case inside. */
export interface Preview {
  calendarDaysSelected: number;
  deductedWorkingDays: number;
  days: DayBreakdown[];
  weekendCounted: boolean;
  holidaysCounted: boolean;
  ledgerBalance: number;
  committedToOpenRequests: number;
  effectiveBalance: number;
  projectedBalance: number;
  isAdvanceLeave: boolean;
  shortfall: number;
  leaveYear: LeaveYear;
}

export interface LedgerEntry {
  entry_id: number;
  entry_type: string;
  quantity: number;
  source_reference: string;
  reason: string | null;
  created_at: string;
  running_balance: number;
}

export interface NotificationItem {
  notification_id: number;
  template_key: string;
  subject: string;
  body: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SUPPRESSED';
  read_at: string | null;
  related_request_id: number | null;
  created_at: string;
}

export interface Employee {
  employee_id: number;
  full_name: string;
  work_email: string;
  employee_code: string;
  designation: string | null;
  department_id: number | null;
  grade_id: number | null;
  management_level_id: number | null;
  region_id: number | null;
  reporting_manager_id: number | null;
  gender: string | null;
  marital_status: string | null;
  status: string;
  phone: string | null;
  personal_email: string | null;
  date_of_birth: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  has_avatar: boolean;
}

export interface MeResponse {
  employee: Employee;
  roles: string[];
}

export interface Approval {
  approval_id: number;
  stage: string;
  decision: 'APPROVE' | 'REJECT';
  on_behalf_of_id: number | null;
  reason: string | null;
  decision_timestamp: string;
}

export interface Watcher {
  watcher_id: number;
  watcher_employee_id: number;
  watcherEmployee: { full_name: string } | null;
}

export interface Attachment {
  attachment_id: number;
  file_name: string;
  content_type: string;
  size_bytes: number;
}

/** The FULL-scope shape backend-py's detail service builds (see
 * backend-py/app/services/leave_request/detail.py's _build_full_detail) —
 * base LeaveRequest columns plus the associations Node eager-loads. Node's
 * own casing survives here (`LeaveType`/`currentApprover`/`watcherEmployee`
 * are capitalized/camelCase on purpose, not a mistake). */
export interface FullRequestDetail extends LeaveRequest {
  LeaveType: { type_name: string; permits_attachments: boolean } | null;
  currentApprover: { full_name: string } | null;
  approvals: Approval[];
  watchers: Watcher[];
  attachments: Attachment[];
}

export interface WatcherMaskedDetail {
  request_id: number;
  start_date: string;
  end_date: string;
  state: LeaveRequestState;
  deducted_days: number | null;
  employee_id: number;
  leave_type_name: string;
}

export type ScopedDetail =
  | { scope: 'FULL'; request: FullRequestDetail }
  | { scope: 'WATCHER_MASKED'; request: WatcherMaskedDetail }
  | { scope: 'DENIED'; request: null };

export interface ApprovalsQueueRow extends LeaveRequest {
  is_delegated: boolean;
  delegated_for: number | null;
  decision_type: 'REQUEST' | 'CANCELLATION';
}

export interface UpdateOwnProfile {
  phone?: string | null;
  personal_email?: string | null;
  date_of_birth?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  gender?: string | null;
  marital_status?: string | null;
}

export interface TeamMemberBalance {
  leaveType: string;
  ledgerBalance: number;
  committedToOpenRequests: number;
  effectiveBalance: number;
}

export interface TeamBalanceRow {
  employee: Employee;
  balances: TeamMemberBalance[];
}

export interface PeerCalendarEntry {
  request_id: number;
  employee_id: number;
  employee_name: string | null;
  start_date: string;
  end_date: string;
  state: LeaveRequestState;
}

export interface TeamCalendarEntry extends PeerCalendarEntry {
  leave_type_id: number;
  leave_type_name: string | null;
}

export interface Holiday {
  holiday_id: number;
  holiday_date: string;
  holiday_name: string;
  leave_year_id: number;
  region_id: number | null;
  is_optional: boolean;
}

/** Unlike the plain GET /api/holidays list (snake_case, a raw model dump),
 * this nested shape comes from EligibleHolidayOut, a CamelOut schema — every
 * field is camelCase here, not just isSelected. See
 * backend-py/app/schemas/optional_holiday.py. */
export interface EligibleHoliday {
  holidayId: number;
  holidayDate: string;
  holidayName: string;
  leaveYearId: number;
  regionId: number | null;
  isOptional: boolean;
  isSelected: boolean;
}

export interface OptionalHolidaySummary {
  quota: number;
  taken: number;
  remaining: number;
  eligibleHolidays: EligibleHoliday[];
}

export interface DelegateCandidate {
  employee_id: number;
  full_name: string;
  employee_code: string;
}

export interface EligibleDelegates {
  candidates: DelegateCandidate[];
  fallbackUsed: boolean;
}

export interface Delegation {
  delegation_id: number;
  nominator_id: number;
  delegate_id: number;
  set_by_id: number;
  from_date: string;
  to_date: string;
  revoked_at: string | null;
  nominator_name?: string | null;
  delegate_name?: string | null;
}

export interface LeaveTakenRow {
  request_id: number;
  employee_id: number;
  employee_name: string;
  employee_code: string;
  department_id: number | null;
  grade_id: number | null;
  leave_type_id: number;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  state: LeaveRequestState;
  deducted_days: number | null;
}

export interface StandingWatcher {
  standing_watcher_id: number;
  watched_employee_id: number;
  watcher_employee_id: number;
  from_date: string;
  to_date: string;
  added_by_id: number;
}

export interface CompOff {
  comp_off_id: number;
  employee_id: number;
  work_date: string;
  hours_or_days: number;
  approved_by: number;
  notes: string | null;
}

export interface LeavePolicy {
  policy_id: number;
  leave_type_id: number;
  annual_entitlement: number;
  carries_forward: boolean;
  carry_forward_cap: number | null;
}

export interface LeaveAccrualConfig {
  accrual_config_id: number;
  leave_type_id: number;
  accrual_method: string;
  posting_day: number | null;
}

export interface LeaveTypeWithPolicy {
  leave_type: LeaveType;
  policy: LeavePolicy | null;
  accrual_config: LeaveAccrualConfig | null;
}

export interface SelfApprovalGrant {
  self_approval_permission_id: number;
  employee_id: number;
  granted_by: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  notes: string | null;
}

export interface BlackoutPeriod {
  blackout_id: number;
  name: string;
  start_date: string;
  end_date: string;
  leave_type_id: number | null;
  is_active: boolean;
}

export interface TeamCapacityLimit {
  capacity_limit_id: number;
  manager_employee_id: number;
  max_concurrent_on_leave: number;
  effective_from: string;
  effective_to: string | null;
}

export interface TeamCapacityLimitWithManager extends TeamCapacityLimit {
  manager_name: string | null;
}

export interface Encashment {
  encashment_id: number;
  employee_id: number;
  leave_type_id: number;
  leave_year_id: number;
  days_encashed: number;
  status: string;
  requested_at: string;
  notes: string | null;
}

/** Uppercase on purpose — matches config_service.py's CONFIG_DEFAULTS/_cast
 * vocabulary exactly ("STRING"/"JSON"/"BOOL"/"INT"), not a generic guess. */
export interface OrgConfig {
  config_key: string;
  config_value: string;
  value_type: 'BOOL' | 'INT' | 'JSON' | 'STRING';
  description: string | null;
}

export interface HolidayAdded {
  holiday: Holiday;
  affectedRequestIds: number[];
}

export interface OptionalHolidayUsageRow {
  employeeId: number;
  fullName: string;
  employeeCode: string;
  taken: number;
  remaining: number;
}

export interface OptionalHolidayUsage {
  quota: number;
  employees: OptionalHolidayUsageRow[];
}

export interface AuditLogRow {
  audit_id: number;
  actor_id: number | null;
  actor_name: string | null;
  is_system_actor: boolean;
  action: string;
  entity_type: string;
  entity_id: string | number | null;
  prior_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  timestamp: string;
}

export interface LedgerAllEntry {
  entry_id: number;
  employee_id: number;
  employee_name: string;
  employee_code: string;
  leave_type_id: number;
  leave_type_name: string;
  entry_type: string;
  quantity: number;
  created_at: string;
}

export interface WorkingPattern {
  working_pattern_id: number;
  pattern_code: string;
  pattern_name: string;
  weekend_days: string;
  is_active: boolean;
}

export interface WorkingPatternAssignment {
  assignment_id: number;
  employee_id: number;
  working_pattern_id: number;
  effective_from: string;
  effective_to: string | null;
}

export interface WorkingPatternAssignmentDetail extends WorkingPatternAssignment {
  employee_full_name: string;
  employee_code: string;
  pattern_name: string;
  pattern_code: string;
}

export interface Region {
  region_id: number;
  region_code: string;
  region_name: string;
  is_active: boolean;
}

export interface ManagementLevel {
  management_level_id: number;
  level_code: string;
  level_name: string;
  level_rank: number;
  is_active: boolean;
}

export interface NotificationTemplate {
  template_key: string;
  subject_template: string;
  body_template: string;
  is_active: boolean;
}
