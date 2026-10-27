import client from './client';
import { API_BASE } from './paths';

export const getMe = () => client.get('/employees/me');
export const getDashboard = () => client.get('/employees/dashboard');
export const getMyTeam = () => client.get('/employees/my-team');
export const getPeerCalendar = (params) => client.get('/employees/peer-calendar', { params });
export const listEmployees = (params) => client.get('/employees', { params });
export const updateManager = (employeeId, managerId) =>
  client.patch(`/employees/${employeeId}/manager`, { managerId });
export const updateEmployeeDetails = (employeeId, payload) => client.patch(`/employees/${employeeId}`, payload);
export const getWatchableEmployees = () => client.get('/employees/watchable');
export const listStandingWatchers = (employeeId) => client.get(`/employees/${employeeId}/standing-watchers`);
export const addStandingWatcher = (employeeId, payload) => client.post(`/employees/${employeeId}/standing-watchers`, payload);
export const reassignManager = (employeeId, newManagerId, transferPendingRequests) =>
  client.post(`/employees/${employeeId}/reassign-manager`, { newManagerId, transferPendingRequests });
// TT Suite: only the global admin (portal) creates people and assigns roles. HR asks for a
// role change — role is 'employee' | 'manager' | 'admin', or null for "no access".
export const requestRoleChange = (employeeId, role, note) =>
  client.post(`/employees/${employeeId}/role-request`, { role, note });
export const listRoleRequests = () => client.get('/employees/role-requests');
export const getMyDigestPreference = () => client.get('/employees/me/digest-preference');
export const setMyDigestPreference = (digestEnabled) => client.patch('/employees/me/digest-preference', { digestEnabled });
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
