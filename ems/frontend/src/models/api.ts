// One function per backend endpoint, grouped by resource.
import { api, portal } from "./http";
import type {
  AdminUser, AdvanceRow, AuditRow, BankChange, Batch, BatchPreview, Category, ClaimDetail, ClaimSummary, Dashboard, Delegation,
  Flag, InboxItem, LineInput, Limit, Lists, Me, Mode, Notification, NotifyKind, PolicyOverview, Preset, Settings, SuiteMe,
  SuitePreferences, UserLookup,
} from "./types";

const q = (params: Record<string, string | number | null | undefined>) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== null && v !== undefined && v !== "" && s.set(k, String(v)));
  const str = s.toString();
  return str ? `?${str}` : "";
};

/** The TT Suite portal (sign-in, theme, app access). Absolute paths: the portal owns /api/* at the site root. */
export const suiteApi = {
  me: () => portal<SuiteMe>("GET", "/api/me"),
  savePreferences: (preset: Preset, mode: Mode) => portal<SuitePreferences>("PUT", "/api/me/preferences", { preset, mode }),
  logout: () => portal<void>("POST", "/api/auth/logout"),
};

export const authApi = {
  me: () => api<Me>("GET", "/api/auth/me"),
  changeBank: (body: { account_holder: string; account_no: string; ifsc: string; upi: string }) => api<Me>("PUT", "/api/auth/me/bank", body),
  saveNotifyPrefs: (prefs: Partial<Record<NotifyKind, boolean>>) => api<Me>("PUT", "/api/auth/me/notifications", { prefs }),
  signOutEverywhere: () => api<void>("POST", "/api/auth/me/sign-out-everywhere"),
};

export type ClaimScope = "mine" | "team" | "routed" | "finance" | "all";
export type ClaimFilter = { status?: string; q?: string; department?: string; since?: string };
export type ClaimBody = { title: string; project: string; purpose: string; lines: LineInput[] };

export const claimsApi = {
  list: (scope: ClaimScope, f: ClaimFilter = {}) => api<ClaimSummary[]>("GET", `/api/claims${q({ scope, ...f })}`),
  exportUrl: (scope: ClaimScope, f: ClaimFilter = {}, format: "csv" | "xlsx" = "csv") => `/api/claims/export${q({ scope, ...f, format })}`,
  withdraw: (id: number) => api<ClaimDetail>("POST", `/api/claims/${id}/withdraw`),
  comment: (id: number, body: string) => api<ClaimDetail>("POST", `/api/claims/${id}/comments`, { body }),
  get: (id: number) => api<ClaimDetail>("GET", `/api/claims/${id}`),
  /** Saves and submits in one step; if the claim cannot be submitted nothing is saved (there are no drafts). */
  submitNew: (body: ClaimBody) => api<ClaimDetail>("POST", "/api/claims", body),
  resubmit: (id: number, body: ClaimBody) => api<ClaimDetail>("PUT", `/api/claims/${id}`, body),
  policyCheck: (lines: LineInput[], claim_id?: number) => api<Flag[][]>("POST", "/api/claims/policy-check", { lines, claim_id }),
  uploadReceipt: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api<{ receipt_path: string; receipt_name: string }>("POST", "/api/claims/receipts", form);
  },
  receiptUrl: (claimId: number, lineId: number) => `/api/claims/${claimId}/lines/${lineId}/receipt`,
  requestAdvance: (body: { amount: number; purpose: string; expected_settlement_date: string }) =>
    api<ClaimDetail>("POST", "/api/claims/advances", body),
  resubmitAdvance: (id: number, body: { amount: number; purpose: string; expected_settlement_date: string }) =>
    api<ClaimDetail>("PUT", `/api/claims/advances/${id}`, body),
};

export const approvalsApi = {
  inbox: () => api<InboxItem[]>("GET", "/api/approvals/inbox"),
  approve: (stepId: number, amount?: number, comment?: string) =>
    api<ClaimDetail>("POST", `/api/approvals/steps/${stepId}/approve`, { amount, comment }),
  rejectLine: (stepId: number, reason: string) => api<ClaimDetail>("POST", `/api/approvals/steps/${stepId}/reject`, { reason }),
  bulkApprove: (step_ids: number[]) =>
    api<{ approved: number[]; failed: { step_id: number; error: string }[] }>("POST", "/api/approvals/bulk-approve", { step_ids }),
  bulkSendBack: (claim_ids: number[], reason: string) =>
    api<{ returned: number[]; failed: { claim_id: number; error: string }[] }>("POST", "/api/approvals/bulk-send-back", { claim_ids, reason }),
  sendBack: (claimId: number, reason: string) => api<ClaimDetail>("POST", `/api/approvals/claims/${claimId}/send-back`, { reason }),
  financeApprove: (claimId: number, comment?: string) =>
    api<ClaimDetail>("POST", `/api/approvals/claims/${claimId}/finance-approve`, { comment }),
  financeReject: (claimId: number, reason: string) =>
    api<ClaimDetail>("POST", `/api/approvals/claims/${claimId}/finance-reject`, { reason }),
  clearDuplicate: (claimId: number, lineId: number, reason: string) =>
    api<ClaimDetail>("POST", `/api/approvals/claims/${claimId}/lines/${lineId}/clear-duplicate`, { reason }),
};

export const delegationsApi = {
  list: () => api<{ given: Delegation[]; received: Delegation[] }>("GET", "/api/delegations"),
  create: (body: { delegate_id: number; start_date: string; end_date: string; reason: string }) =>
    api<Delegation>("POST", "/api/delegations", body),
  cancel: (id: number) => api<void>("POST", `/api/delegations/${id}/cancel`),
};

export const financeApi = {
  queue: () => api<{ ready: ClaimSummary[]; sent: ClaimSummary[]; failed: ClaimSummary[] }>("GET", "/api/finance/queue"),
  preview: (month: string) => api<BatchPreview>("GET", `/api/finance/batch-preview${q({ month })}`),
  sendBatch: (month: string, expected_count: number) => api<Batch>("POST", "/api/finance/batches", { month, expected_count }),
  batches: () => api<Batch[]>("GET", "/api/finance/batches"),
  batchExportUrl: (id: number) => `/api/finance/batches/${id}/export`,
  paid: (id: number) => api<ClaimSummary>("POST", `/api/finance/claims/${id}/paid`),
  failed: (id: number, reason: string) => api<ClaimSummary>("POST", `/api/finance/claims/${id}/failed`, { reason }),
  retry: (id: number) => api<ClaimSummary>("POST", `/api/finance/claims/${id}/retry`),
  advances: () => api<AdvanceRow[]>("GET", "/api/finance/advances"),
  recover: (id: number) => api<ClaimSummary>("POST", `/api/finance/advances/${id}/recover`),
  bankChanges: () => api<BankChange[]>("GET", "/api/finance/bank-changes"),
  verifyBank: (userId: number) => api<void>("POST", `/api/finance/bank-changes/${userId}/verify`),
  rejectBank: (userId: number, reason: string) => api<void>("POST", `/api/finance/bank-changes/${userId}/reject`, { reason }),
};

export const lookupsApi = {
  categories: () => api<Category[]>("GET", "/api/lookups/categories"),
  users: () => api<UserLookup[]>("GET", "/api/lookups/users"),
  companyGstins: () => api<Record<string, string>>("GET", "/api/lookups/company-gstins"),
  lists: () => api<Lists>("GET", "/api/lookups/lists"),
  policy: () => api<PolicyOverview>("GET", "/api/policy"),
};

export const notificationsApi = {
  list: () => api<Notification[]>("GET", "/api/notifications"),
  unread: () => api<{ count: number }>("GET", "/api/notifications/unread-count"),
  readAll: () => api<void>("POST", "/api/notifications/read-all"),
};

export type UserForm = Omit<AdminUser, "id">;
export type CategoryForm = Omit<Category, "id">;

export const adminApi = {
  users: () => api<AdminUser[]>("GET", "/api/admin/users"),
  importUsers: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api<{ created: number; updated: number; errors: string[] }>("POST", "/api/admin/users/import", form);
  },
  lastChange: (entity?: string) => api<{ who: string; what: string; at: string } | null>("GET", `/api/admin/last-change${q({ entity })}`),
  saveUser: (body: UserForm, id?: number) => api<AdminUser>(id ? "PUT" : "POST", id ? `/api/admin/users/${id}` : "/api/admin/users", body),
  categories: () => api<Category[]>("GET", "/api/admin/categories"),
  saveCategory: (body: CategoryForm, id?: number) =>
    api<Category>(id ? "PUT" : "POST", id ? `/api/admin/categories/${id}` : "/api/admin/categories", body),
  deleteCategory: (id: number) => api<void>("DELETE", `/api/admin/categories/${id}`),
  limits: () => api<Limit[]>("GET", "/api/admin/limits"),
  saveLimit: (body: Limit, id?: number) => api<Limit>(id ? "PUT" : "POST", id ? `/api/admin/limits/${id}` : "/api/admin/limits", body),
  settings: () => api<Settings>("GET", "/api/admin/settings"),
  saveSettings: (body: Partial<Settings>) => api<Settings>("PUT", "/api/admin/settings", body),
  reassign: (step_id: number, approver_id: number) => api<{ claim_id: number }>("POST", "/api/admin/reassign", { step_id, approver_id }),
  runReminders: () => api<{ reminded: number; escalated: number }>("POST", "/api/admin/run-reminders"),
  dashboard: (start?: string, end?: string) => api<Dashboard>("GET", `/api/admin/dashboard${q({ start, end })}`),
  audit: (f: AuditFilter) => api<AuditRow[]>("GET", `/api/admin/audit${q(f)}`),
  auditExportUrl: (f: AuditFilter) => `/api/admin/audit/export${q(f)}`,
};

export type AuditFilter = {
  user_id?: number | null;
  claim_no?: string;
  level?: string;
  start?: string;
  end?: string;
};
