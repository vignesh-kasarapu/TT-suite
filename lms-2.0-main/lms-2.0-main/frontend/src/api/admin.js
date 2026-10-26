import client from './client';

export const listDepartments = () => client.get('/admin/departments');
export const createDepartment = (payload) => client.post('/admin/departments', payload);
export const listManagementLevels = () => client.get('/admin/management-levels');

export const listGrades = () => client.get('/admin/grades');
export const createGrade = (payload) => client.post('/admin/grades', payload);

export const listRegions = () => client.get('/admin/regions');
export const createRegion = (payload) => client.post('/admin/regions', payload);

export const listProjects = () => client.get('/admin/projects');
export const createProject = (payload) => client.post('/admin/projects', payload);
export const assignProject = (payload) => client.post('/admin/project-assignments', payload);

/** The endpoint returns one row per type as {leave_type, policy, accrual_config}. Every
 * caller wants a single object, so the nesting is unwrapped once here rather than in each
 * of the four screens that read it — all of which previously read a shape that did not
 * exist and rendered blank names and zero entitlements. */
const flattenLeaveType = (row) => ({ ...row.leave_type, policy: row.policy, accrual_config: row.accrual_config });

export const listLeaveTypes = () =>
  client.get('/admin/leave-types').then((res) => ({ ...res, data: res.data.map(flattenLeaveType) }));
export const createLeaveType = (payload) => client.post('/admin/leave-types', payload);
export const updateLeaveTypePolicy = (leaveTypeId, payload) => client.patch(`/admin/leave-types/${leaveTypeId}/policy`, payload);

export const listHolidays = (leaveYearId) => client.get('/admin/holidays', { params: { leaveYearId } });
export const addHoliday = (payload) => client.post('/admin/holidays', payload);
export const removeHoliday = (holidayId) => client.delete(`/admin/holidays/${holidayId}`);
export const getOptionalHolidayUsage = (leaveYearId) => client.get('/admin/holidays/optional-usage', { params: { leaveYearId } });

export const listSelfApprovalGrants = () => client.get('/admin/self-approval-permissions');
export const grantSelfApproval = (payload) => client.post('/admin/self-approval-permissions', payload);
export const revokeSelfApproval = (grantId) => client.post(`/admin/self-approval-permissions/${grantId}/revoke`);

export const listWorkingPatterns = (includeInactive = false) => client.get('/admin/working-patterns', { params: { includeInactive } });
export const createWorkingPattern = (payload) => client.post('/admin/working-patterns', payload);
export const deactivateWorkingPattern = (id) => client.post(`/admin/working-patterns/${id}/deactivate`);
export const reactivateWorkingPattern = (id) => client.post(`/admin/working-patterns/${id}/reactivate`);
export const assignWorkingPattern = (payload) => client.post('/admin/working-pattern-assignments', payload);
export const listWorkingPatternAssignments = () => client.get('/admin/working-pattern-assignments');
export const updateWorkingPatternAssignment = (assignmentId, payload) =>
  client.patch(`/admin/working-pattern-assignments/${assignmentId}`, payload);

export const listNotificationTemplates = () => client.get('/admin/notification-templates');
export const createNotificationTemplate = (payload) => client.post('/admin/notification-templates', payload);
export const updateNotificationTemplate = (templateKey, payload) => client.patch(`/admin/notification-templates/${templateKey}`, payload);
export const setNotificationTemplateActive = (templateKey, isActive) => client.patch(`/admin/notification-templates/${templateKey}/active`, { isActive });
export const deleteNotificationTemplate = (templateKey) => client.delete(`/admin/notification-templates/${templateKey}`);

export const listBlackoutPeriods = (includeInactive = false) => client.get('/r3/blackout-periods', { params: { includeInactive } });
export const createBlackoutPeriod = (payload) => client.post('/r3/blackout-periods', payload);
export const updateBlackoutPeriod = (id, payload) => client.patch(`/r3/blackout-periods/${id}`, payload);
export const setBlackoutPeriodActive = (id, isActive) => client.patch(`/r3/blackout-periods/${id}/active`, { isActive });
export const deactivateBlackoutPeriod = (id) => client.post(`/r3/blackout-periods/${id}/deactivate`);
export const removeBlackoutPeriod = (id) => client.delete(`/r3/blackout-periods/${id}`);

export const listTeamCapacityLimits = () => client.get('/r3/team-capacity-limits');
export const createTeamCapacityLimit = (payload) => client.post('/r3/team-capacity-limits', payload);
export const updateTeamCapacityLimit = (id, payload) => client.patch(`/r3/team-capacity-limits/${id}`, payload);
export const setTeamCapacityLimitActive = (id, isActive) => client.patch(`/r3/team-capacity-limits/${id}/active`, { isActive });
export const removeTeamCapacityLimit = (id) => client.delete(`/r3/team-capacity-limits/${id}`);

export const createEncashment = (payload) => client.post('/r3/leave-encashment', payload);
export const creditCompOff = (payload) => client.post('/r3/comp-off', payload);
export const listLeaveTypesShort = listLeaveTypes;
