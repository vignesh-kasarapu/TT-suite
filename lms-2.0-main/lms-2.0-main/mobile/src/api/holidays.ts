import { api } from './client';
import type { Holiday, OptionalHolidaySummary } from '../types/models';

export function listHolidays() {
  return api.get<Holiday[]>('/api/holidays');
}

export function getOptionalSummary(leaveYearId?: number) {
  return api.get<OptionalHolidaySummary>('/api/holidays/optional-summary', { leave_year_id: leaveYearId });
}

export function selectOptionalHoliday(holidayId: number) {
  return api.post(`/api/holidays/${holidayId}/select`);
}

export function deselectOptionalHoliday(holidayId: number) {
  return api.delete(`/api/holidays/${holidayId}/select`);
}

export function getOptionalSummaryFor(employeeId: number, leaveYearId?: number) {
  return api.get<OptionalHolidaySummary>(`/api/holidays/optional-summary/${employeeId}`, { leave_year_id: leaveYearId });
}

export function assignOptionalHoliday(holidayId: number, employeeId: number) {
  return api.post(`/api/holidays/${holidayId}/select/${employeeId}`);
}

export function unassignOptionalHoliday(holidayId: number, employeeId: number) {
  return api.delete(`/api/holidays/${holidayId}/select/${employeeId}`);
}
