const {
  Department, Grade, Region, Project, ProjectAssignment, LeaveType, LeavePolicy, LeaveAccrualConfig, ManagementLevel,
  Holiday, LeaveYear, LeaveRequest,
} = require('../models');
const auditService = require('./audit.service');

// ---- Departments / Grades / Regions / Projects: simple masters, no hardcoded values anywhere else ----
async function listDepartments() { return Department.findAll({ order: [['department_name', 'ASC']] }); }
async function listManagementLevels() { return ManagementLevel.findAll({ where: { is_active: true }, order: [['level_rank', 'ASC']] }); }
async function createDepartment(payload, actorId) {
  const row = await Department.create({ department_code: payload.code, department_name: payload.name });
  await auditService.record({ actorId, action: 'DEPARTMENT_CREATED', entityType: 'departments', entityId: row.department_id, newValue: payload });
  return row;
}

// "Region of working" — filters which holidays apply to an employee (Phase 7).
async function listRegions() { return Region.findAll({ where: { is_active: true }, order: [['region_name', 'ASC']] }); }
async function createRegion(payload, actorId) {
  const row = await Region.create({ region_code: payload.code, region_name: payload.name });
  await auditService.record({ actorId, action: 'REGION_CREATED', entityType: 'regions', entityId: row.region_id, newValue: payload });
  return row;
}

async function listGrades() { return Grade.findAll({ order: [['grade_name', 'ASC']] }); }
async function createGrade(payload, actorId) {
  const row = await Grade.create({ grade_code: payload.code, grade_name: payload.name });
  await auditService.record({ actorId, action: 'GRADE_CREATED', entityType: 'grades', entityId: row.grade_id, newValue: payload });
  return row;
}

async function listProjects() { return Project.findAll({ order: [['project_name', 'ASC']] }); }
async function createProject(payload, actorId) {
  const row = await Project.create({ project_code: payload.code, project_name: payload.name });
  await auditService.record({ actorId, action: 'PROJECT_CREATED', entityType: 'projects', entityId: row.project_id, newValue: payload });
  return row;
}

/** LMS-013: assignments may overlap freely — no exclusivity check here. */
async function assignProject(payload, actorId) {
  const row = await ProjectAssignment.create({
    employee_id: payload.employeeId, project_id: payload.projectId, project_lead_id: payload.projectLeadId,
    effective_from: payload.effectiveFrom, effective_to: payload.effectiveTo || null, created_by: actorId,
  });
  await auditService.record({ actorId, action: 'PROJECT_ASSIGNMENT_CREATED', entityType: 'project_assignments', entityId: row.assignment_id, newValue: payload });
  return row;
}

// ---- Leave types / policy / accrual (LMS-024, LMS-026, LMS-027) ----
async function listLeaveTypes() {
  return LeaveType.findAll({ include: [LeavePolicy, LeaveAccrualConfig], order: [['type_name', 'ASC']] });
}

async function createLeaveType(payload, actorId) {
  // LMS-025 is enforced structurally: is_system is never settable here, so a caller can never mint a second LOP.
  const leaveType = await LeaveType.create({
    type_code: payload.typeCode,
    type_name: payload.typeName,
    is_sick_leave: !!payload.isSickLeave,
    is_balance_affecting: payload.isBalanceAffecting !== false,
    permits_half_day: !!payload.permitsHalfDay,
    permits_attachments: !!payload.permitsAttachments,
  });

  await LeavePolicy.create({
    leave_type_id: leaveType.leave_type_id,
    annual_entitlement: payload.annualEntitlement,
    carries_forward: !!payload.carriesForward,
    carry_forward_cap: payload.carryForwardCap || null,
    updated_by: actorId,
  });

  await LeaveAccrualConfig.create({
    leave_type_id: leaveType.leave_type_id,
    accrual_method: payload.accrualMethod,
    posting_day: payload.postingDay || 1,
    updated_by: actorId,
  });

  await auditService.record({ actorId, action: 'LEAVE_TYPE_CREATED', entityType: 'leave_types', entityId: leaveType.leave_type_id, newValue: payload });
  return leaveType;
}

async function updateLeaveTypePolicy(leaveTypeId, payload, actorId) {
  const leaveType = await LeaveType.findByPk(leaveTypeId);
  if (!leaveType) throw Object.assign(new Error('Leave type not found'), { status: 404, code: 'NOT_FOUND' });
  if (leaveType.is_system) {
    throw Object.assign(new Error('The system LOP type cannot be edited or deleted (LMS-025).'), { status: 400, code: 'SYSTEM_TYPE_LOCKED' });
  }
  // Some leave types (e.g. Compensatory Off) have no LeavePolicy row at all — entitlement/
  // carry-forward edits are meaningless for those, but is_selectable_by_employee still lives
  // on LeaveType itself, so enable/disable must keep working regardless.
  const policy = await LeavePolicy.findOne({ where: { leave_type_id: leaveTypeId } });
  const prior = {
    annual_entitlement: policy?.annual_entitlement,
    carries_forward: policy?.carries_forward,
    carry_forward_cap: policy?.carry_forward_cap,
    is_selectable_by_employee: leaveType.is_selectable_by_employee,
  };

  if (policy) {
    policy.annual_entitlement = payload.annualEntitlement ?? policy.annual_entitlement;
    policy.carries_forward = payload.carriesForward ?? policy.carries_forward;
    policy.carry_forward_cap = payload.carryForwardCap ?? policy.carry_forward_cap;
    policy.updated_by = actorId;
    await policy.save();
  }

  // Whether employees can apply for this type at all — independent of the policy numbers above.
  if (payload.isSelectableByEmployee !== undefined) {
    leaveType.is_selectable_by_employee = payload.isSelectableByEmployee;
    await leaveType.save();
  }

  await auditService.record({ actorId, action: 'LEAVE_POLICY_UPDATED', entityType: 'leave_policies', entityId: policy?.policy_id ?? leaveType.leave_type_id, priorValue: prior, newValue: payload });
  return policy || leaveType;
}

// ---- Holiday calendar (LMS-028) ----
async function listHolidays(leaveYearId) {
  return Holiday.findAll({
    where: { leave_year_id: leaveYearId },
    include: [{ model: Region, attributes: ['region_name'] }],
    order: [['holiday_date', 'ASC']],
  });
}

async function addHoliday(payload, actorId) {
  const holiday = await Holiday.create({
    holiday_date: payload.date, holiday_name: payload.name, leave_year_id: payload.leaveYearId,
    region_id: payload.regionId || null, is_optional: !!payload.isOptional, created_by: actorId,
  });

  // 7.3.15: warn where a holiday is added inside an already-approved leave span.
  const { Op } = require('sequelize');
  const affected = await LeaveRequest.findAll({
    where: { state: 'APPROVED', start_date: { [Op.lte]: payload.date }, end_date: { [Op.gte]: payload.date } },
  });

  await auditService.record({ actorId, action: 'HOLIDAY_ADDED', entityType: 'holidays', entityId: holiday.holiday_id, newValue: payload });
  return { holiday, affectedRequestIds: affected.map((r) => r.request_id) };
}

async function removeHoliday(holidayId, actorId) {
  const holiday = await Holiday.findByPk(holidayId);
  await holiday.destroy();
  await auditService.record({ actorId, action: 'HOLIDAY_REMOVED', entityType: 'holidays', entityId: holidayId, priorValue: { holiday_date: holiday.holiday_date, holiday_name: holiday.holiday_name } });
  return { removed: true };
}

module.exports = {
  listDepartments, listManagementLevels, createDepartment, listGrades, createGrade,
  listRegions, createRegion, listProjects, createProject, assignProject,
  listLeaveTypes, createLeaveType, updateLeaveTypePolicy, listHolidays, addHoliday, removeHoliday,
};
