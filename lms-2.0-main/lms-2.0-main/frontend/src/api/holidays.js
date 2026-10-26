import client from './client';

export const listHolidays = () => client.get('/holidays');
export const getOptionalHolidaySummary = (leaveYearId) => client.get('/holidays/optional-summary', { params: { leaveYearId } });
export const selectOptionalHoliday = (holidayId) => client.post(`/holidays/${holidayId}/select`);
export const deselectOptionalHoliday = (holidayId) => client.delete(`/holidays/${holidayId}/select`);

// Manager/HR acting on behalf of a specific team member.
export const getOptionalHolidaySummaryFor = (employeeId, leaveYearId) =>
  client.get(`/holidays/optional-summary/${employeeId}`, { params: { leaveYearId } });
export const assignOptionalHoliday = (holidayId, employeeId) => client.post(`/holidays/${holidayId}/select/${employeeId}`);
export const unassignOptionalHoliday = (holidayId, employeeId) => client.delete(`/holidays/${holidayId}/select/${employeeId}`);
