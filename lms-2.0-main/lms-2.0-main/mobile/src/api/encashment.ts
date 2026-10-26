import { api } from './client';
import type { Encashment } from '../types/models';

export function createEncashment(employeeId: number, leaveTypeId: number, leaveYearId: number, daysEncashed: number, notes?: string) {
  return api.post<Encashment>('/api/r3/leave-encashment', {
    employee_id: employeeId,
    leave_type_id: leaveTypeId,
    leave_year_id: leaveYearId,
    days_encashed: daysEncashed,
    notes,
  });
}

export function getMyEncashments() {
  return api.get<Encashment[]>('/api/r3/leave-encashment/mine');
}
