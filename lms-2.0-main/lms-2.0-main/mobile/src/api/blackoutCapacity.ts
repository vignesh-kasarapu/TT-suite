import { api } from './client';
import type { BlackoutPeriod, TeamCapacityLimitWithManager } from '../types/models';

export function listBlackoutPeriods(includeInactive = true) {
  return api.get<BlackoutPeriod[]>('/api/r3/blackout-periods', { include_inactive: includeInactive });
}

export function createBlackoutPeriod(name: string, startDate: string, endDate: string, leaveTypeId?: number | null) {
  return api.post<BlackoutPeriod>('/api/r3/blackout-periods', { name, start_date: startDate, end_date: endDate, leave_type_id: leaveTypeId ?? null });
}

export function setBlackoutActive(blackoutId: number, isActive: boolean) {
  return api.patch<BlackoutPeriod>(`/api/r3/blackout-periods/${blackoutId}/active`, { is_active: isActive });
}

export function removeBlackoutPeriod(blackoutId: number) {
  return api.delete(`/api/r3/blackout-periods/${blackoutId}`);
}

export function listAllCapacityLimits() {
  return api.get<TeamCapacityLimitWithManager[]>('/api/r3/team-capacity-limits');
}

export function createCapacityLimit(managerEmployeeId: number, maxConcurrentOnLeave: number, effectiveFrom: string, effectiveTo?: string | null) {
  return api.post('/api/r3/team-capacity-limits', {
    manager_employee_id: managerEmployeeId,
    max_concurrent_on_leave: maxConcurrentOnLeave,
    effective_from: effectiveFrom,
    effective_to: effectiveTo ?? null,
  });
}

export function setCapacityLimitActive(capacityLimitId: number, isActive: boolean) {
  return api.patch(`/api/r3/team-capacity-limits/${capacityLimitId}/active`, { is_active: isActive });
}

export function removeCapacityLimit(capacityLimitId: number) {
  return api.delete(`/api/r3/team-capacity-limits/${capacityLimitId}`);
}
