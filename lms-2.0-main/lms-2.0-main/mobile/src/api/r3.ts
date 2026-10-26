import { api } from './client';
import type { CompOff } from '../types/models';

export function creditCompOff(employeeId: number, workDate: string, hoursOrDays: number, notes?: string) {
  return api.post<CompOff>('/api/r3/comp-off', { employee_id: employeeId, work_date: workDate, hours_or_days: hoursOrDays, notes });
}
