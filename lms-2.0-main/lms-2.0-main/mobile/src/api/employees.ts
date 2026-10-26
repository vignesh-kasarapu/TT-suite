import { api } from './client';
import type { Dashboard, Employee, MeResponse, PeerCalendarEntry, StandingWatcher, TeamBalanceRow, TeamCalendarEntry, UpdateOwnProfile } from '../types/models';

export function getMe() {
  return api.get<MeResponse>('/api/employees/me');
}

export function updateMe(payload: UpdateOwnProfile) {
  return api.patch<Employee>('/api/employees/me', payload);
}

export function uploadAvatar(file: { uri: string; name: string; type: string }) {
  return api.upload<Employee>('/api/employees/me/avatar', file);
}

export function getDashboard() {
  return api.get<Dashboard>('/api/employees/dashboard');
}

export function getMyTeam() {
  return api.get<TeamBalanceRow[]>('/api/employees/my-team');
}

export function getTeamCalendar(startDate: string, endDate: string) {
  return api.get<TeamCalendarEntry[]>('/api/employees/team-calendar', { start_date: startDate, end_date: endDate });
}

export function getPeerCalendar(startDate: string, endDate: string) {
  return api.get<PeerCalendarEntry[]>('/api/employees/peer-calendar', { start_date: startDate, end_date: endDate });
}

export function getWatchableEmployees() {
  return api.get<Employee[]>('/api/employees/watchable');
}

export function listEmployees(search?: string) {
  return api.get<Employee[]>('/api/employees', { search });
}

export function getStandingWatchers(employeeId: number) {
  return api.get<StandingWatcher[]>(`/api/employees/${employeeId}/standing-watchers`);
}

export function addStandingWatcher(employeeId: number, watcherEmployeeId: number, fromDate: string, toDate: string) {
  return api.post<StandingWatcher>(`/api/employees/${employeeId}/standing-watchers`, {
    watcher_employee_id: watcherEmployeeId,
    from_date: fromDate,
    to_date: toDate,
  });
}
