import { api } from './client';
import type { SelfApprovalGrant } from '../types/models';

export function listSelfApprovalGrants() {
  return api.get<SelfApprovalGrant[]>('/api/admin/self-approval-permissions');
}

export function grantSelfApproval(employeeId: number, effectiveFrom: string, effectiveTo?: string | null, notes?: string) {
  return api.post<SelfApprovalGrant>('/api/admin/self-approval-permissions', {
    employee_id: employeeId,
    effective_from: effectiveFrom,
    effective_to: effectiveTo || null,
    notes,
  });
}

export function revokeSelfApproval(grantId: number) {
  return api.post<SelfApprovalGrant>(`/api/admin/self-approval-permissions/${grantId}/revoke`);
}
