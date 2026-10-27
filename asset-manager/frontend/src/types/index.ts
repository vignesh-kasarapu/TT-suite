export type UserRole = 'ADMIN' | 'ASSET_MANAGER' | 'EMPLOYEE';

export type AssetStatus = 'AVAILABLE' | 'ASSIGNED' | 'IN_MAINTENANCE' | 'RETIRED';

export type ReturnReason = 'REPLACEMENT' | 'EMPLOYEE_LEFT' | 'OTHER' | 'IN_MAINTENANCE';

export type OldAssetAction = 'REPAIR' | 'RETIRE';

export type ReplacementStatus =
  | 'PENDING'
  | 'ON_HOLD'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED';

export type AssetRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  active_assets_count?: number;
  created_at: string;
}

/** The suite role for Asset Management: employee (EMPLOYEE), manager (ASSET_MANAGER), admin (ADMIN). */
export type SuiteRole = 'employee' | 'manager' | 'admin';

/** An open role-change request, waiting for the global admin (GET /users/role-requests). */
export interface RoleRequest {
  id: number;
  email: string;
  /** null = remove the person's Asset Management access */
  role: SuiteRole | null;
  requested_at: string;
  requested_by?: string | null;
}

export interface RoleChangeRequestResult {
  id: number;
  role: SuiteRole | null;
  message: string;
}

export interface PaginatedUsersResponse {
  items: User[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface Category {
  id: number;
  name: string;
  total_assets?: number;
  available_assets?: number;
  created_at: string;
}

export interface CategoryCreatePayload {
  name: string;
}

export interface CategoryUpdatePayload {
  name: string;
}

export interface Asset {
  id: number;
  /** Auto-generated immutable Asset ID (TEK-…) */
  tag: string;
  name: string;
  serial_no: string;
  service_tag?: string | null;
  asset_tag?: string | null;
  category_id: number;
  category_name?: string | null;
  purchase_date: string;
  cost: number;
  location: string;
  status: AssetStatus;
  awaiting_employee_details?: boolean;
  version: number;
  created_at: string;
  assigned_to_name?: string | null;
}

export interface PaginatedAssetsResponse {
  items: Asset[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface AssetCreatePayload {
  name: string;
  serial_no: string;
  service_tag?: string | null;
  asset_tag?: string | null;
  category_id: number;
  purchase_date: string;
  cost: number;
  location: string;
}

export interface AssetUpdatePayload {
  name?: string;
  serial_no?: string;
  service_tag?: string | null;
  asset_tag?: string | null;
  category_id?: number;
  purchase_date?: string;
  cost?: number;
  location?: string;
}

export interface AssignmentRecord {
  id: number;
  asset_id: number;
  asset_tag?: string | null;
  asset_name?: string | null;
  user_id: number;
  user_name?: string | null;
  user_email?: string | null;
  assigned_on: string;
  returned_on?: string | null;
  return_reason?: ReturnReason | null;
  asset_status?: AssetStatus | null;
  created_at: string;
}

export interface AssignedAsset {
  id: number;
  /** Auto-generated immutable Asset ID (TEK-…) */
  tag: string;
  name: string;
  serial_no: string;
  service_tag?: string | null;
  asset_tag?: string | null;
  category_id: number;
  category_name?: string | null;
  purchase_date: string;
  cost: number;
  location: string;
  status: AssetStatus;
  awaiting_employee_details?: boolean;
  version: number;
  created_at: string;
  assignment_id: number;
  assigned_on: string;
  user_id: number;
  user_name?: string | null;
  user_email?: string | null;
}

export interface MaintenanceRecord {
  id: number;
  asset_id: number;
  asset_tag?: string | null;
  asset_name?: string | null;
  replacement_request_id?: number | null;
  opened_on: string;
  closed_on?: string | null;
  description: string;
  resolution?: string | null;
  cost?: number | null;
  created_at: string;
  requested_by_name?: string | null;
  requested_by_role?: UserRole | null;
  employee_name?: string | null;
  reason?: string | null;
  temporary?: boolean | null;
  old_asset_action?: OldAssetAction | null;
  replacement_status?: ReplacementStatus | null;
}

export interface AssetHistoryResponse {
  asset: Asset;
  assignments: AssignmentRecord[];
  maintenance_records: MaintenanceRecord[];
}

export interface AssignAssetPayload {
  user_id: number;
  assigned_on?: string;
}

export interface ReturnAssetPayload {
  next_status: 'AVAILABLE' | 'IN_MAINTENANCE' | 'RETIRED';
  returned_on?: string;
  return_reason?: ReturnReason;
  description?: string;
  cost?: number;
}

export interface MaintenanceCreatePayload {
  description: string;
  opened_on?: string;
  cost?: number;
}

export interface MaintenanceClosePayload {
  closed_on?: string;
  cost?: number;
  description?: string;
  resolution: string;
}

export interface ReplacementRequest {
  id: number;
  asset_id: number;
  asset_tag?: string | null;
  asset_name?: string | null;
  asset_category_id?: number | null;
  asset_category_name?: string | null;
  requested_by: number;
  requester_name?: string | null;
  requester_email?: string | null;
  reason: string;
  old_asset_action: OldAssetAction;
  temporary: boolean;
  replacement_asset_id?: number | null;
  replacement_asset_tag?: string | null;
  replacement_asset_name?: string | null;
  status: ReplacementStatus;
  decided_by?: number | null;
  decider_name?: string | null;
  decider_email?: string | null;
  decision_comment?: string | null;
  decided_at?: string | null;
  created_at: string;
}

export interface ReplacementRequestCreatePayload {
  asset_id: number;
  reason: string;
  old_asset_action: OldAssetAction;
  temporary: boolean;
}

export interface ApproveReplacementPayload {
  replacement_asset_id: number;
  comment?: string;
}

export interface RejectReplacementPayload {
  comment: string;
}

export interface HoldReplacementPayload {
  comment?: string;
}

export interface AssetRequest {
  id: number;
  requested_by: number;
  requester_name?: string | null;
  requester_email?: string | null;
  name: string;
  category_id?: number | null;
  category_name?: string | null;
  is_other: boolean;
  other_category_name?: string | null;
  other_reason?: string | null;
  reason: string;
  serial_no?: string | null;
  service_tag?: string | null;
  asset_tag?: string | null;
  purchase_date?: string | null;
  cost?: number | null;
  location?: string | null;
  status: AssetRequestStatus;
  requires_employee_register?: boolean;
  created_asset_id?: number | null;
  created_asset_tag?: string | null;
  decided_by?: number | null;
  decider_name?: string | null;
  decider_email?: string | null;
  decision_comment?: string | null;
  decided_at?: string | null;
  created_at: string;
}

export interface AssetRequestCreatePayload {
  category_id?: number | null;
  is_other: boolean;
  other_category_name?: string | null;
  reason: string;
}

export interface ApproveAssetRequestPayload {
  category_id?: number;
  /** AVAILABLE inventory asset to assign on approve when stock exists. */
  asset_id?: number;
  comment?: string;
  /** Only when no AVAILABLE stock: remind employee to register. */
  requires_employee_register?: boolean;
}

export interface AvailableAssetsForRequestResponse {
  category_id?: number | null;
  category_name?: string | null;
  has_available: boolean;
  items: Asset[];
}

export interface RejectAssetRequestPayload {
  comment: string;
}

export interface StatusCountItem {
  status: AssetStatus;
  count: number;
}

export interface CategoryReportItem {
  category_id: number;
  category_name: string;
  total: number;
  available: number;
  assigned: number;
  in_maintenance: number;
  retired: number;
  total_value: number;
}

export interface ReportsSummaryResponse {
  total_assets: number;
  total_value: number;
  by_status: Record<AssetStatus, number>;
  status_breakdown: StatusCountItem[];
  by_category: Record<string, number>;
  category_breakdown: CategoryReportItem[];
}

export interface ApiErrorResponse {
  status: number;
  message: string;
  timestamp: string;
  /** TT Suite: e.g. NO_APP_ACCESS, UNAUTHENTICATED */
  code?: string;
}

export interface BulkImportRowError {
  row: number;
  identifier: string;
  message: string;
}

export interface AssetBulkImportResponse {
  total_rows: number;
  imported_count: number;
  skipped_count: number;
  created_categories: string[];
  imported_items: Asset[];
  errors: BulkImportRowError[];
}

