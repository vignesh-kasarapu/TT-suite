import client from './client';
import { API_BASE } from './paths';

export const getMe = () => client.get('/employees/me');
export const getDashboard = () => client.get('/employees/dashboard');
export const getMyTeam = () => client.get('/employees/my-team');
export const getPeerCalendar = (params) => client.get('/employees/peer-calendar', { params });
export const listEmployees = (params) => client.get('/employees', { params });
export const createEmployee = (payload) => client.post('/employees', payload);
export const updateManager = (employeeId, managerId) =>
  client.patch(`/employees/${employeeId}/manager`, { managerId });
export const updateEmployeeDetails = (employeeId, payload) => client.patch(`/employees/${employeeId}`, payload);
export const getWatchableEmployees = () => client.get('/employees/watchable');
export const listStandingWatchers = (employeeId) => client.get(`/employees/${employeeId}/standing-watchers`);
export const addStandingWatcher = (employeeId, payload) => client.post(`/employees/${employeeId}/standing-watchers`, payload);
export const deactivateEmployee = (employeeId, lastWorkingDay) =>
  client.post(`/employees/${employeeId}/deactivate`, { lastWorkingDay });
export const reassignManager = (employeeId, newManagerId, transferPendingRequests) =>
  client.post(`/employees/${employeeId}/reassign-manager`, { newManagerId, transferPendingRequests });
export const bulkImportEmployees = (file) => {
  const form = new FormData();
  form.append('file', file);
  return client.post('/employees/bulk-import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const getMyDigestPreference = () => client.get('/employees/me/digest-preference');
export const setMyDigestPreference = (digestEnabled) => client.patch('/employees/me/digest-preference', { digestEnabled });
export const getEmployeeRoles = (employeeId) => client.get(`/employees/${employeeId}/roles`);
export const assignEmployeeRole = (employeeId, roleCode) => client.post(`/employees/${employeeId}/roles`, { roleCode });
export const revokeEmployeeRole = (employeeId, roleCode) => client.delete(`/employees/${employeeId}/roles`, { data: { roleCode } });
export const getTeamCalendar = (params) => client.get('/employees/team-calendar', { params });
export const updateMyProfile = (payload) => client.patch('/employees/me', payload);
export const uploadMyAvatar = (file) => {
  const form = new FormData();
  form.append('avatar', file);
  return client.post('/employees/me/avatar', form, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const removeMyAvatar = () => client.delete('/employees/me/avatar');
// `version` changes whenever a new picture is stored; without it the URL is identical
// before and after an upload and the browser keeps serving the old image (or a cached 404).
export const avatarUrl = (employeeId, version) =>
  (employeeId ? `${API_BASE}/employees/${employeeId}/avatar${version ? `?v=${encodeURIComponent(version)}` : ''}` : null);
