import { api } from './client';
import type { LeaveTypeWithPolicy } from '../types/models';

export interface LeaveTypeCreate {
  type_code: string;
  type_name: string;
  is_sick_leave?: boolean;
  is_balance_affecting?: boolean;
  permits_half_day?: boolean;
  permits_attachments?: boolean;
  annual_entitlement: number;
  carries_forward?: boolean;
  carry_forward_cap?: number | null;
  accrual_method: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  posting_day?: number | null;
}

export interface LeaveTypePolicyUpdate {
  annual_entitlement?: number;
  carries_forward?: boolean;
  carry_forward_cap?: number | null;
  is_selectable_by_employee?: boolean;
}

export function listLeaveTypes() {
  return api.get<LeaveTypeWithPolicy[]>('/api/admin/leave-types');
}

export function createLeaveType(payload: LeaveTypeCreate) {
  return api.post<LeaveTypeWithPolicy>('/api/admin/leave-types', payload);
}

export function updateLeaveTypePolicy(leaveTypeId: number, payload: LeaveTypePolicyUpdate) {
  return api.patch<LeaveTypeWithPolicy>(`/api/admin/leave-types/${leaveTypeId}/policy`, payload);
}
