import { api } from './client';
import type { HolidayAdded, Holiday, OptionalHolidayUsage } from '../types/models';

export function listHolidaysForYear(leaveYearId: number) {
  return api.get<Holiday[]>('/api/admin/holidays', { leave_year_id: leaveYearId });
}

export function getOptionalUsage(leaveYearId: number) {
  return api.get<OptionalHolidayUsage>('/api/admin/holidays/optional-usage', { leave_year_id: leaveYearId });
}

export function addHoliday(payload: { holiday_date: string; holiday_name: string; leave_year_id: number; region_id?: number | null; is_optional?: boolean }) {
  return api.post<HolidayAdded>('/api/admin/holidays', payload);
}

export function removeHoliday(holidayId: number) {
  return api.delete(`/api/admin/holidays/${holidayId}`);
}
