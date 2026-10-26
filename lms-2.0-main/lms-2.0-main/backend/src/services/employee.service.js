const { Op } = require('sequelize');
const { Employee, Department, Region, LeaveType, LeaveYear, LeaveRequest, Role } = require('../models');
const balanceService = require('./balance.service');
const approvalRouting = require('./approvalRouting.service');
const auditService = require('./audit.service');
const roleAssignmentService = require('./roleAssignment.service');
const notificationService = require('./notification.service');
const env = require('../config/env');

/** LMS-036/dashboard: balance card per leave type — available, committed, effective, projected. */
async function getDashboard(employeeId) {
  const leaveYear = await LeaveYear.findOne({ where: { is_current: true } });
  const leaveTypes = await LeaveType.findAll({ where: { is_selectable_by_employee: true } });

  const balances = await Promise.all(leaveTypes.map(async (lt) => {
    const b = await balanceService.getEffectiveBalance(employeeId, lt.leave_type_id, leaveYear.leave_year_id);
    return { leaveType: lt, ...b };
  }));

  const pending = await LeaveRequest.findAll({
    where: { employee_id: employeeId, state: { [Op.in]: ['PENDING_MANAGER', 'PENDING_HR'] } },
  });
  const upcoming = await LeaveRequest.findAll({
    where: { employee_id: employeeId, state: 'APPROVED', start_date: { [Op.gte]: new Date() } },
    order: [['start_date', 'ASC']],
    limit: 5,
  });
  const withdrawalWindow = await LeaveRequest.findOne({
    where: { employee_id: employeeId, state: 'REJECTED_PENDING_WITHDRAWAL' },
  });

  return { balances, pending, upcoming, withdrawalWindow, leaveYear };
}

async function listEmployees({ search, departmentId, gradeId } = {}) {
  const where = {};
  if (search) where.full_name = { [Op.like]: `%${search}%` }; // MySQL's default collation is case-insensitive already
  if (departmentId) where.department_id = departmentId;
  if (gradeId) where.grade_id = gradeId;
  // full_name is a Sequelize virtual field (first_name + last_name), so it
  // cannot be used in MySQL's ORDER BY clause. Sort by the real columns.
  return Employee.findAll({
    where,
    include: [
      { model: Role, attributes: ['role_code', 'role_name'], through: { attributes: [] } },
      { model: Department, attributes: ['department_name'] },
      { model: Region, attributes: ['region_name'] },
    ],
    order: [['first_name', 'ASC'], ['last_name', 'ASC']],
  });
}

/** Finds a department by name, creating it (with a derived unique code) if it doesn't exist yet. */
async function resolveDepartmentId(departmentName) {
  const name = departmentName.trim();
  let department = await Department.findOne({ where: { department_name: name } });
  if (!department) {
    const baseCode = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 24) || 'DEPARTMENT';
    let departmentCode = baseCode;
    let suffix = 1;
    while (await Department.findOne({ where: { department_code: departmentCode } })) {
      departmentCode = `${baseCode.slice(0, 24 - String(suffix).length - 1)}_${suffix}`;
      suffix += 1;
    }
    department = await Department.create({ department_code: departmentCode, department_name: name });
  }
  return department.department_id;
}

/** LMS-010/012: create employee, then auto pro-rata entitlement is posted by a dedicated onboarding job. */
async function onboardEmployee(payload, createdBy) {
  const requiredFields = [
    ['fullName', 'Full name'],
    ['workEmail', 'Work email'],
    ['employeeCode', 'Employee code'],
    ['dateOfJoining', 'Date of joining'],
    ['designation', 'Designation'],
  ];
  for (const [field, label] of requiredFields) {
    if (!String(payload[field] || '').trim()) {
      throw Object.assign(new Error(`${label} is required.`), { status: 400, code: 'VALIDATION_ERROR' });
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.workEmail).trim())) {
    throw Object.assign(new Error('Enter a valid work email address.'), { status: 400, code: 'VALIDATION_ERROR' });
  }
  if (!/^[-A-Za-z0-9_]+$/.test(String(payload.employeeCode).trim())) {
    throw Object.assign(new Error('Employee code may contain only letters, numbers, hyphens, and underscores.'), { status: 400, code: 'VALIDATION_ERROR' });
  }
  if (Number.isNaN(Date.parse(payload.dateOfJoining))) {
    throw Object.assign(new Error('Enter a valid date of joining.'), { status: 400, code: 'VALIDATION_ERROR' });
  }

  const roleCode = payload.roleCode || 'EMPLOYEE';
  const allowedRoles = ['EMPLOYEE', 'MANAGER', 'HR_ADMIN'];
  if (!allowedRoles.includes(roleCode)) {
    throw Object.assign(new Error('Select a valid assigned role.'), { status: 400, code: 'VALIDATION_ERROR' });
  }

  if (!payload.departmentId && !payload.departmentName?.trim()) {
    throw Object.assign(new Error('Department is required.'), { status: 400, code: 'VALIDATION_ERROR' });
  }

  if (payload.reportingManagerId) {
    const circular = await approvalRouting.wouldCreateCircularHierarchy(null, payload.reportingManagerId);
    if (circular) throw Object.assign(new Error('This reporting relationship would be circular.'), { status: 400, code: 'CIRCULAR_HIERARCHY' });
  }

  let departmentId = payload.departmentId || null;
  if (payload.departmentName?.trim()) {
    departmentId = await resolveDepartmentId(payload.departmentName);
  }

  const employee = await Employee.create({
    entra_oid: payload.entraOid || null,
    work_email: payload.workEmail,
    employee_code: payload.employeeCode,
    full_name: payload.fullName,
    date_of_joining: payload.dateOfJoining,
    department_id: departmentId,
    grade_id: payload.gradeId || null,
    management_level_id: payload.managementLevelId || null,
    region_id: payload.regionId || null,
    gender: payload.gender || null,
    marital_status: payload.maritalStatus || null,
    designation: payload.designation,
    reporting_manager_id: payload.reportingManagerId || null,
  });

  await roleAssignmentService.assignRole(employee.employee_id, roleCode, createdBy);

  await auditService.record({
    actorId: createdBy, action: 'EMPLOYEE_CREATED', entityType: 'employees', entityId: employee.employee_id, newValue: payload,
  });

  // Pro-rata opening entitlement posting (BR-13 to BR-15) is triggered here via the accrual job.
  const { postOpeningProRata } = require('../jobs/accrual.job');
  await postOpeningProRata(employee.employee_id);

  // Invite the new hire to sign in with their work-email Microsoft account. Reuses the
  // existing notification/email pipeline (notification.service.js -> utils/mailer.js) —
  // authentication itself, org-membership verification, and role-based access are all
  // already handled by the Entra SSO callback + requireAuth/requireRole on every request.
  await notificationService.notify({
    recipientId: employee.employee_id,
    templateKey: 'EMPLOYEE_ONBOARDING_INVITE',
    tokens: { fullName: employee.full_name, signInUrl: `${env.clientBaseUrl}/login` },
  });

  return employee;
}

/** HR edits an existing employee's profile fields. Reporting manager and role are deliberately
 * excluded here — they have their own dedicated, business-rule-checked actions (setReportingManager /
 * reassignManager, roleAssignment.service.js) rather than being folded into a generic bulk update. */
async function updateEmployeeDetails(employeeId, payload, actorId) {
  const employee = await Employee.findByPk(employeeId);
  if (!employee) throw Object.assign(new Error('Employee not found'), { status: 404, code: 'NOT_FOUND' });

  if (payload.fullName !== undefined && !String(payload.fullName).trim()) {
    throw Object.assign(new Error('Full name is required.'), { status: 400, code: 'VALIDATION_ERROR' });
  }
  if (payload.designation !== undefined && !String(payload.designation).trim()) {
    throw Object.assign(new Error('Designation is required.'), { status: 400, code: 'VALIDATION_ERROR' });
  }

  const updates = {};
  if (payload.fullName !== undefined) updates.full_name = payload.fullName.trim();
  if (payload.designation !== undefined) updates.designation = payload.designation.trim();
  if (payload.managementLevelId !== undefined) updates.management_level_id = payload.managementLevelId || null;
  if (payload.gender !== undefined) updates.gender = payload.gender || null;
  if (payload.maritalStatus !== undefined) updates.marital_status = payload.maritalStatus || null;
  if (payload.regionId !== undefined) updates.region_id = payload.regionId || null;
  if (payload.departmentName?.trim()) {
    updates.department_id = await resolveDepartmentId(payload.departmentName);
  }

  await employee.update(updates);

  await auditService.record({
    actorId, action: 'EMPLOYEE_UPDATED', entityType: 'employees', entityId: employee.employee_id, newValue: updates,
  });

  return employee;
}

/** Self-service "edit profile": an employee updating their OWN record. Deliberately a
 * separate, narrower allow-list from updateEmployeeDetails (HR-only) — nothing org-controlled
 * (name, designation, department, grade, region, management level, work email, employee code,
 * reporting manager, role) is reachable here, only personal/contact fields. */
async function updateOwnProfile(employeeId, payload, actorId) {
  const employee = await Employee.findByPk(employeeId);
  if (!employee) throw Object.assign(new Error('Employee not found'), { status: 404, code: 'NOT_FOUND' });

  if (payload.personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.personalEmail).trim())) {
    throw Object.assign(new Error('Enter a valid personal email address.'), { status: 400, code: 'VALIDATION_ERROR' });
  }
  if (payload.dateOfBirth && Number.isNaN(Date.parse(payload.dateOfBirth))) {
    throw Object.assign(new Error('Enter a valid date of birth.'), { status: 400, code: 'VALIDATION_ERROR' });
  }

  const updates = {};
  if (payload.phone !== undefined) updates.phone = payload.phone?.trim() || null;
  if (payload.personalEmail !== undefined) updates.personal_email = payload.personalEmail?.trim() || null;
  if (payload.dateOfBirth !== undefined) updates.date_of_birth = payload.dateOfBirth || null;
  if (payload.emergencyContactName !== undefined) updates.emergency_contact_name = payload.emergencyContactName?.trim() || null;
  if (payload.emergencyContactPhone !== undefined) updates.emergency_contact_phone = payload.emergencyContactPhone?.trim() || null;
  if (payload.gender !== undefined) updates.gender = payload.gender || null;
  if (payload.maritalStatus !== undefined) updates.marital_status = payload.maritalStatus?.trim() || null;

  await employee.update(updates);

  await auditService.record({
    actorId, action: 'PROFILE_UPDATED', entityType: 'employees', entityId: employee.employee_id, newValue: updates,
  });

  return employee;
}

/** Persists a newly uploaded avatar's disk path on the employee's own record, deleting the
 * previous file (if any) so uploads don't accumulate orphaned images on disk. */
async function updateOwnAvatar(employeeId, newAvatarPath) {
  const employee = await Employee.findByPk(employeeId);
  if (!employee) throw Object.assign(new Error('Employee not found'), { status: 404, code: 'NOT_FOUND' });

  const previousPath = employee.avatar_path;
  await employee.update({ avatar_path: newAvatarPath });

  if (previousPath && previousPath !== newAvatarPath) {
    const fs = require('fs');
    fs.unlink(previousPath, () => {}); // best-effort cleanup, never block the response on it
  }

  return employee;
}

/** LMS-011: refuse circular relationships at entry time (BR-37). */
async function setReportingManager(employeeId, managerId, actorId) {
  const circular = await approvalRouting.wouldCreateCircularHierarchy(employeeId, managerId);
  if (circular) {
    throw Object.assign(
      new Error(`Assigning this manager would create a circular reporting chain through employee #${managerId}.`),
      { status: 400, code: 'CIRCULAR_HIERARCHY' },
    );
  }
  const employee = await Employee.findByPk(employeeId);
  const prior = employee.reporting_manager_id;
  employee.reporting_manager_id = managerId;
  await employee.save();
  await auditService.record({
    actorId, action: 'MANAGER_REASSIGNED', entityType: 'employees', entityId: employeeId,
    priorValue: { reporting_manager_id: prior }, newValue: { reporting_manager_id: managerId },
  });
  return employee;
}

/** BR-39: Manager sees every employee beneath them at any depth. */
async function getTeamBalances(managerId) {
  const allReports = await getAllReportsRecursive(managerId);
  const leaveYear = await LeaveYear.findOne({ where: { is_current: true } });
  const leaveTypes = await LeaveType.findAll({ where: { is_selectable_by_employee: true } });

  return Promise.all(allReports.map(async (emp) => {
    const balances = await Promise.all(leaveTypes.map(async (lt) => ({
      leaveType: lt.type_name,
      ...(await balanceService.getEffectiveBalance(emp.employee_id, lt.leave_type_id, leaveYear.leave_year_id)),
    })));
    return { employee: emp, balances };
  }));
}

async function getAllReportsRecursive(managerId) {
  const direct = await Employee.findAll({ where: { reporting_manager_id: managerId } });
  let all = [...direct];
  for (const d of direct) {
    all = all.concat(await getAllReportsRecursive(d.employee_id));
  }
  return all;
}

/** LMS-061: is `employeeId` a direct or indirect report of `managerId`? */
async function isInManagerHierarchy(managerId, employeeId) {
  const reports = await getAllReportsRecursive(managerId);
  return reports.some((r) => String(r.employee_id) === String(employeeId));
}

/** BR-41: peer calendar shows name, dates, status only — never leave type. */
/**
 * §7.3.7: Team calendar (Manager/HR-Admin) — every employee beneath them at
 * any depth, WITH leave type shown. Distinct from the peer calendar below,
 * which is deliberately narrower and never sends type (BR-41/NFR-14).
 */
async function getTeamCalendar(managerId, { from, to } = {}) {
  const reports = await getAllReportsRecursive(managerId);
  const reportIds = reports.map((r) => r.employee_id);

  const where = { employee_id: { [Op.in]: reportIds }, state: { [Op.in]: ['APPROVED', 'PENDING_MANAGER', 'PENDING_HR'] } };
  if (from) where.end_date = { [Op.gte]: from };
  if (to) where.start_date = { [Op.lte]: to };

  return LeaveRequest.findAll({
    where,
    include: [
      { model: Employee, as: 'employee', attributes: ['employee_id', 'full_name', 'designation', 'employee_code'] },
      { model: LeaveType, attributes: ['type_name', 'type_code'] },
    ],
    attributes: ['request_id', 'employee_id', 'start_date', 'end_date', 'deducted_days', 'reason', 'is_half_day', 'half_day_portion', 'state', 'leave_type_id'],
  });
}

/**
 * BR-41 (as refined by Workflows §10.3): peers share the same reporting Manager
 * AND the same management level — a Manager's own peer calendar must not
 * include their direct reports just because those reports also happen to
 * report to the same person during a reorg edge case, and vice versa.
 */
async function getPeerCalendar(employeeId, { from, to } = {}) {
  const self = await Employee.findByPk(employeeId);
  const peers = await Employee.findAll({
    where: { reporting_manager_id: self.reporting_manager_id, management_level_id: self.management_level_id },
  });
  const peerIds = peers.map((p) => p.employee_id);

  const where = { employee_id: { [Op.in]: peerIds }, state: { [Op.in]: ['APPROVED', 'PENDING_MANAGER', 'PENDING_HR'] } };
  if (from) where.end_date = { [Op.gte]: from };
  if (to) where.start_date = { [Op.lte]: to };

  const requests = await LeaveRequest.findAll({
    where,
    include: [{ model: Employee, as: 'employee', attributes: ['employee_id', 'full_name', 'designation', 'employee_code'] }],
    attributes: ['request_id', 'employee_id', 'start_date', 'end_date', 'deducted_days', 'reason', 'is_half_day', 'half_day_portion', 'state'], // leave_type_id excluded for peers (BR-41)
  });
  return requests;
}

/** LMS-060/063: candidates for the "add watcher" picker — must hold Manager (derived from hierarchy) or HR/Admin (explicit role). */
async function listWatchableEmployees() {
  const seen = new Map();

  const managers = await Employee.findAll({
    where: { is_active: true },
    include: [
      { model: Employee, as: 'directReports', where: { is_active: true }, attributes: [], required: true },
      { model: Department, attributes: ['department_name'] },
    ],
    attributes: ['employee_id', 'first_name', 'last_name', 'full_name', 'employee_code', 'designation'],
  });
  for (const m of managers) seen.set(m.employee_id, m);

  const { EmployeeRole } = require('../models');
  const hrAdminRows = await EmployeeRole.findAll({
    include: [
      { model: Role, where: { role_code: 'HR_ADMIN' }, attributes: [] },
      {
        model: Employee,
        attributes: ['employee_id', 'first_name', 'last_name', 'full_name', 'employee_code', 'designation'],
        include: [{ model: Department, attributes: ['department_name'] }],
      },
    ],
  });
  for (const row of hrAdminRows) seen.set(row.Employee.employee_id, row.Employee);

  return [...seen.values()];
}

module.exports = { getDashboard, listEmployees, onboardEmployee, updateEmployeeDetails, updateOwnProfile, updateOwnAvatar, setReportingManager, getTeamBalances, getTeamCalendar, getPeerCalendar, listWatchableEmployees, isInManagerHierarchy, getAllReportsRecursive };
