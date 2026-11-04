import client from './client';

export const listDepartments = () => client.get('/admin/departments');
export const createDepartment = (payload) => client.post('/admin/departments', payload);
export const renameDepartment = (departmentId, departmentName) =>
  client.patch(`/admin/departments/${departmentId}`, { departmentName });
export const listManagementLevels = () => client.get('/admin/management-levels');

export const listGrades = () => client.get('/admin/grades');
export const createGrade = (payload) => client.post('/admin/grades', payload);

export const listRegions = () => client.get('/admin/regions');
export const createRegion = (payload) => client.post('/admin/regions', payload);
export const renameRegion = (regionId, regionName) => client.patch(`/admin/regions/${regionId}`, { regionName });

export const listProjects = () => client.get('/admin/projects');
export const createProject = (payload) => client.post('/admin/projects', payload);
export const assignProject = (payload) => client.post('/admin/project-assignments', payload);

/** The endpoint returns one row per type as {leave_type, policy, accrual_config}. Every
 * caller wants a single object, so the nesting is unwrapped once here rather than in each
 * of the four screens that read it — all of which previously read a shape that did not
 * exist and rendered blank names and zero entitlements. */
const flattenLeaveType = (row) => ({
  ...row.leave_type, policy: row.policy, accrual_config: row.accrual_config, pool: row.pool,
});

/** `archived`: true for the Archived view, false for the active list, undefined for both. */
export const listLeaveTypes = (archived) =>
  client.get('/admin/leave-types', { params: archived === undefined ? {} : { archived } })
    .then((res) => ({ ...res, data: res.data.map(flattenLeaveType) }));
export const createLeaveType = (payload) => client.post('/admin/leave-types', payload);
export const updateLeaveTypePolicy = (leaveTypeId, payload) => client.patch(`/admin/leave-types/${leaveTypeId}/policy`, payload);
/** Soft delete: the type is archived, with every request, ledger row and report it appears in kept. */
export const archiveLeaveType = (leaveTypeId) => client.delete(`/admin/leave-types/${leaveTypeId}`);
export const restoreLeaveType = (leaveTypeId) => client.post(`/admin/leave-types/${leaveTypeId}/restore`);
export const previewEntitlementChange = (leaveTypeId, annualEntitlement) =>
  client.get(`/admin/leave-types/${leaveTypeId}/entitlement-preview`, { params: { annualEntitlement } });

// Shared entitlement pools: one entitlement several leave types draw on.
export const listEntitlementPools = (includeArchived = false) =>
  client.get('/admin/entitlement-pools', { params: { includeArchived } });
export const createEntitlementPool = (payload) => client.post('/admin/entitlement-pools', payload);
export const updateEntitlementPool = (poolId, payload) => client.patch(`/admin/entitlement-pools/${poolId}`, payload);
export const archiveEntitlementPool = (poolId) => client.delete(`/admin/entitlement-pools/${poolId}`);

// Balances: what HR sees, the opening-balance workflow and temporary restrictions.
export const getEmployeeBalances = (employeeId, leaveYearId) =>
  client.get(`/admin/balances/${employeeId}`, { params: { leaveYearId } });
export const previewOpeningBalances = (payload) => client.post('/admin/balances/opening-preview', payload);
export const applyOpeningBalances = (payload) => client.post('/admin/balances/opening', payload);
export const getOrganizationBalances = (leaveYearId) =>
  client.get('/admin/balances-summary', { params: { leaveYearId } });
export const listRestrictions = (params) => client.get('/admin/restrictions', { params });
export const createRestriction = (payload) => client.post('/admin/restrictions', payload);
export const cancelRestriction = (restrictionId, reason) =>
  client.post(`/admin/restrictions/${restrictionId}/cancel`, { reason });
export const releaseExpiredRestrictions = () => client.post('/admin/restrictions/release-expired');
export const previewCarryForward = (leaveYearId) =>
  client.get('/admin/carry-forward/preview', { params: { leaveYearId } });

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

// Leave encashment: HR raises a request, HR decides it. The balance moves on the decision,
// never on the request (see the backend's encashment_service).
export const createEncashment = (payload) => client.post('/r3/leave-encashment', payload);
export const listEncashments = (params) => client.get('/r3/leave-encashment', { params });
export const decideEncashment = (id, approve, comments) =>
  client.post(`/r3/leave-encashment/${id}/decision`, { approve, comments });
export const getEncashableBalance = (params) => client.get('/r3/leave-encashment/encashable-balance', { params });
export const getMyEncashments = () => client.get('/r3/leave-encashment/mine');

// Compensatory off: a claim for extra work, approved by the manager and then by HR.
export const submitCompOff = (payload) => client.post('/r3/comp-off', payload);
export const listCompOff = (params) => client.get('/r3/comp-off', { params });
export const listPendingCompOff = () => client.get('/r3/comp-off/pending');
export const decideCompOff = (id, approve, comments) =>
  client.post(`/r3/comp-off/${id}/decision`, { approve, comments });
export const getMyCompOff = () => client.get('/r3/comp-off/mine');

// Leave years: the current one, the configured start for the next, and creating it. Creating
// a year never switches to it — carry-forward does that.
export const listLeaveYears = () => client.get('/admin/leave-years');
export const createLeaveYear = (payload) => client.post('/admin/leave-years', payload);

export const listLeaveTypesShort = listLeaveTypes;
