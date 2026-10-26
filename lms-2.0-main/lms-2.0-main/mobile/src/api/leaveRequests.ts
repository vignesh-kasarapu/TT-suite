import { api } from './client';
import type { ApprovalsQueueRow, LeaveRequest, Preview, ScopedDetail } from '../types/models';

// No dedicated "selectable leave types" endpoint exists — GET /api/admin/leave-types
// is HR_ADMIN-only in both the Node original and this port. Like the existing
// React web Apply screen, the leave-type picker is derived from
// getDashboard().balances instead (each entry already nests the full
// LeaveType model for exactly this purpose).

export function preview(params: { leave_type_id: number; start_date: string; end_date: string; is_half_day: boolean }) {
  return api.get<Preview>('/api/leave-requests/preview', params);
}

export function submit(payload: {
  leave_type_id: number;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  half_day_portion?: string | null;
  reason: string;
  attachment_refs?: string[];
}) {
  return api.post<LeaveRequest>('/api/leave-requests', payload);
}

type DraftPayload = {
  leave_type_id: number;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  half_day_portion?: string | null;
  reason: string;
};

export function saveDraft(payload: DraftPayload) {
  return api.post<LeaveRequest>('/api/leave-requests/draft', payload);
}

export function updateDraft(requestId: number, payload: Partial<DraftPayload>) {
  return api.patch<LeaveRequest>(`/api/leave-requests/draft/${requestId}`, payload);
}

export function discardDraft(requestId: number) {
  return api.delete(`/api/leave-requests/draft/${requestId}`);
}

export function submitDraft(requestId: number) {
  return api.post<LeaveRequest>(`/api/leave-requests/draft/${requestId}/submit`);
}

export function addWatcher(requestId: number, watcherEmployeeId: number) {
  return api.post<{ watcher_id: number; watcher_employee_id: number }>(`/api/leave-requests/${requestId}/watchers`, {
    watcher_employee_id: watcherEmployeeId,
  });
}

export function removeWatcher(requestId: number, watcherId: number) {
  return api.delete(`/api/leave-requests/${requestId}/watchers/${watcherId}`);
}

export function listMine() {
  return api.get<LeaveRequest[]>('/api/leave-requests/my');
}

export function getDetail(requestId: number) {
  return api.get<ScopedDetail>(`/api/leave-requests/${requestId}`);
}

export function withdraw(requestId: number) {
  return api.post<LeaveRequest>(`/api/leave-requests/${requestId}/withdraw`);
}

export function requestCancellation(requestId: number) {
  return api.post<LeaveRequest>(`/api/leave-requests/${requestId}/cancellation`);
}

export function listApprovalsQueue() {
  return api.get<ApprovalsQueueRow[]>('/api/leave-requests/approvals-queue');
}

export function decide(requestId: number, decision: 'APPROVE' | 'REJECT', reason?: string) {
  return api.post<LeaveRequest>(`/api/leave-requests/${requestId}/decision`, { decision, reason });
}
