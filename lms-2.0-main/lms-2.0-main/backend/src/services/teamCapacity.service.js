const { Op } = require('sequelize');
const { TeamCapacityLimit, LeaveRequest, Employee } = require('../models');
const auditService = require('./audit.service');

async function listForManager(managerEmployeeId) {
  return TeamCapacityLimit.findAll({ where: { manager_employee_id: managerEmployeeId }, order: [['effective_from', 'DESC']] });
}

/** Global admin-screen list — listForManager above is scoped to one manager (used at
 * approval-time and by the Manager's own view); this is for the "all limits" admin table. */
async function listAll() {
  return TeamCapacityLimit.findAll({
    include: [{ model: Employee, as: 'managerEmployee', attributes: ['first_name', 'last_name', 'full_name', 'employee_code'] }],
    order: [['effective_from', 'DESC']],
  });
}

async function createLimit({ managerEmployeeId, maxConcurrentOnLeave, effectiveFrom, effectiveTo }, actorId) {
  const limit = await TeamCapacityLimit.create({
    manager_employee_id: managerEmployeeId, max_concurrent_on_leave: maxConcurrentOnLeave,
    effective_from: effectiveFrom, effective_to: effectiveTo || null, created_by: actorId,
  });
  await auditService.record({ actorId, action: 'TEAM_CAPACITY_LIMIT_CREATED', entityType: 'team_capacity_limits', entityId: limit.capacity_limit_id, newValue: { managerEmployeeId, maxConcurrentOnLeave, effectiveFrom, effectiveTo } });
  return limit;
}

async function updateLimit(capacityLimitId, { maxConcurrentOnLeave, effectiveFrom, effectiveTo }, actorId) {
  const limit = await TeamCapacityLimit.findByPk(capacityLimitId);
  if (!limit) throw Object.assign(new Error('Team capacity limit not found'), { status: 404, code: 'NOT_FOUND' });
  const prior = { max_concurrent_on_leave: limit.max_concurrent_on_leave, effective_from: limit.effective_from, effective_to: limit.effective_to };

  limit.max_concurrent_on_leave = maxConcurrentOnLeave ?? limit.max_concurrent_on_leave;
  limit.effective_from = effectiveFrom ?? limit.effective_from;
  limit.effective_to = effectiveTo !== undefined ? (effectiveTo || null) : limit.effective_to;
  await limit.save();

  await auditService.record({ actorId, action: 'TEAM_CAPACITY_LIMIT_UPDATED', entityType: 'team_capacity_limits', entityId: capacityLimitId, priorValue: prior, newValue: { maxConcurrentOnLeave, effectiveFrom, effectiveTo } });
  return limit;
}

/** No is_active column exists on this model (unlike BlackoutPeriod) — "disabled" is
 * represented as effective_to = today, so assertWithinCapacity naturally stops applying it
 * going forward; "enabled" clears effective_to back to open-ended. */
async function setActive(capacityLimitId, isActive, actorId) {
  const limit = await TeamCapacityLimit.findByPk(capacityLimitId);
  if (!limit) throw Object.assign(new Error('Team capacity limit not found'), { status: 404, code: 'NOT_FOUND' });
  limit.effective_to = isActive ? null : new Date().toISOString().slice(0, 10);
  await limit.save();
  await auditService.record({ actorId, action: isActive ? 'TEAM_CAPACITY_LIMIT_ENABLED' : 'TEAM_CAPACITY_LIMIT_DISABLED', entityType: 'team_capacity_limits', entityId: capacityLimitId });
  return limit;
}

async function removeLimit(capacityLimitId, actorId) {
  const limit = await TeamCapacityLimit.findByPk(capacityLimitId);
  if (!limit) throw Object.assign(new Error('Team capacity limit not found'), { status: 404, code: 'NOT_FOUND' });
  await limit.destroy();
  await auditService.record({ actorId, action: 'TEAM_CAPACITY_LIMIT_DELETED', entityType: 'team_capacity_limits', entityId: capacityLimitId });
  return { deleted: true };
}

/**
 * LMS-086: restricts how many of a manager's direct reports may be on
 * approved/pending leave at once, on any single day of the requested span.
 * Only direct reports count — the FRD scopes this to "under a given manager,"
 * not the full recursive hierarchy (unlike BR-39's visibility rule).
 */
async function assertWithinCapacity({ employeeId, startDate, endDate }) {
  const employee = await Employee.findByPk(employeeId);
  const managerId = employee.reporting_manager_id;
  if (!managerId) return; // no manager, no team-capacity concept applies

  const activeLimit = await TeamCapacityLimit.findOne({
    where: {
      manager_employee_id: managerId,
      effective_from: { [Op.lte]: startDate },
      [Op.or]: [{ effective_to: null }, { effective_to: { [Op.gte]: endDate } }],
    },
    order: [['effective_from', 'DESC']],
  });
  if (!activeLimit) return;

  const teammates = await Employee.findAll({ where: { reporting_manager_id: managerId } });
  const teammateIds = teammates.map((t) => t.employee_id);

  const overlapping = await LeaveRequest.findAll({
    where: {
      employee_id: { [Op.in]: teammateIds },
      state: { [Op.in]: ['PENDING_MANAGER', 'PENDING_HR', 'APPROVED'] },
      start_date: { [Op.lte]: endDate },
      end_date: { [Op.gte]: startDate },
    },
  });

  const concurrentCount = new Set(overlapping.map((r) => r.employee_id)).size;
  if (concurrentCount >= activeLimit.max_concurrent_on_leave) {
    throw Object.assign(
      new Error(`Approving this would exceed the team capacity limit of ${activeLimit.max_concurrent_on_leave} concurrent leave-taker(s) under this manager.`),
      { status: 400, code: 'TEAM_CAPACITY_EXCEEDED' },
    );
  }
}

module.exports = { listForManager, listAll, createLimit, updateLimit, setActive, removeLimit, assertWithinCapacity };
