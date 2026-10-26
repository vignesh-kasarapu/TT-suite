const { Op } = require('sequelize');
const { WorkingPattern, WorkingPatternAssignment, Employee } = require('../models');
const auditService = require('./audit.service');

/** `includeInactive` is admin-screen-only (mirrors blackoutPeriod.service.js's
 * listBlackoutPeriods) — every business-logic caller (assignPattern's active check,
 * getWeekendOverrideForDate) must keep seeing active patterns only. */
async function listPatterns({ includeInactive = false } = {}) {
  return WorkingPattern.findAll({ where: includeInactive ? {} : { is_active: true }, order: [['pattern_name', 'ASC']] });
}

async function listAssignments() {
  return WorkingPatternAssignment.findAll({
    include: [
      { model: Employee, attributes: ['employee_id', 'first_name', 'last_name', 'employee_code'] },
      { model: WorkingPattern, attributes: ['working_pattern_id', 'pattern_name', 'pattern_code'] },
    ],
    order: [['effective_from', 'DESC']],
  });
}

/** Soft-delete: existing WorkingPatternAssignment rows reference this pattern by FK, so a
 * hard delete would either cascade-destroy history or fail outright — deactivating instead
 * just removes it from future selection (matches the BlackoutPeriod deactivate idiom).
 * Refused outright while any employee (past, present, or future-dated) is assigned to it —
 * reassign or end those assignments first, so a still-referenced pattern never silently
 * disappears from the list out from under someone using it. */
async function deactivatePattern(workingPatternId, actorId) {
  const pattern = await WorkingPattern.findByPk(workingPatternId);
  if (!pattern) throw Object.assign(new Error('Working pattern not found'), { status: 404, code: 'NOT_FOUND' });

  const assignmentCount = await WorkingPatternAssignment.count({ where: { working_pattern_id: workingPatternId } });
  if (assignmentCount > 0) {
    throw Object.assign(
      new Error(`This pattern is assigned to ${assignmentCount} employee(s) and cannot be deleted. Reassign or end those assignments first.`),
      { status: 400, code: 'WORKING_PATTERN_IN_USE' },
    );
  }

  pattern.is_active = false;
  await pattern.save();
  await auditService.record({ actorId, action: 'WORKING_PATTERN_DEACTIVATED', entityType: 'working_patterns', entityId: workingPatternId });
  return { deactivated: true };
}

/** Reactivating is always safe — no in-use guard needed (unlike deactivatePattern),
 * since flipping is_active back to true only makes the pattern selectable again. */
async function reactivatePattern(workingPatternId, actorId) {
  const pattern = await WorkingPattern.findByPk(workingPatternId);
  if (!pattern) throw Object.assign(new Error('Working pattern not found'), { status: 404, code: 'NOT_FOUND' });

  pattern.is_active = true;
  await pattern.save();
  await auditService.record({ actorId, action: 'WORKING_PATTERN_REACTIVATED', entityType: 'working_patterns', entityId: workingPatternId });
  return { reactivated: true };
}

async function createPattern({ patternCode, patternName, weekendDays }, actorId) {
  const pattern = await WorkingPattern.create({
    pattern_code: patternCode, pattern_name: patternName, weekend_days: JSON.stringify(weekendDays),
  });
  await auditService.record({ actorId, action: 'WORKING_PATTERN_CREATED', entityType: 'working_patterns', entityId: pattern.working_pattern_id, newValue: { patternCode, patternName, weekendDays } });
  return pattern;
}

/** LMS-015: exactly one working pattern is active for an employee on any given date. */
function assertNoOverlap(existing, newFrom, newTo) {
  const overlaps = existing.some((a) => {
    const aFrom = new Date(a.effective_from);
    const aTo = a.effective_to ? new Date(a.effective_to) : null;
    const startsBeforeOtherEnds = !aTo || newFrom <= aTo;
    const endsAfterOtherStarts = !newTo || newTo >= aFrom;
    return startsBeforeOtherEnds && endsAfterOtherStarts;
  });
  if (overlaps) {
    throw Object.assign(
      new Error('This employee already has a working pattern assignment covering part of this date range. Patterns may not overlap.'),
      { status: 400, code: 'WORKING_PATTERN_OVERLAP' },
    );
  }
}

/**
 * LMS-015: exactly one working pattern is active for an employee on any given
 * date — enforced here as an overlap check against the employee's existing
 * assignments before the new one is created, not left to a DB constraint
 * (date-range exclusion isn't expressible as a simple unique index in either
 * Postgres or MySQL without extensions this project doesn't require elsewhere).
 */
async function assignPattern({ employeeId, workingPatternId, effectiveFrom, effectiveTo, assignedBy }) {
  const pattern = await WorkingPattern.findByPk(workingPatternId);
  if (!pattern || !pattern.is_active) {
    throw Object.assign(new Error('This working pattern is not active and cannot be assigned.'), { status: 400, code: 'WORKING_PATTERN_INACTIVE' });
  }

  const existing = await WorkingPatternAssignment.findAll({ where: { employee_id: employeeId } });
  assertNoOverlap(existing, new Date(effectiveFrom), effectiveTo ? new Date(effectiveTo) : null);

  const assignment = await WorkingPatternAssignment.create({
    employee_id: employeeId, working_pattern_id: workingPatternId,
    effective_from: effectiveFrom, effective_to: effectiveTo || null, assigned_by: assignedBy,
  });

  await auditService.record({ actorId: assignedBy, action: 'WORKING_PATTERN_ASSIGNED', entityType: 'working_pattern_assignments', entityId: assignment.assignment_id, newValue: { employeeId, workingPatternId, effectiveFrom, effectiveTo } });
  return assignment;
}

/** HR edits an existing assignment's pattern and/or date range, re-checking the same
 * no-overlap rule against this employee's other assignments (excluding itself). */
async function updateAssignment(assignmentId, { workingPatternId, effectiveFrom, effectiveTo }, actorId) {
  const assignment = await WorkingPatternAssignment.findByPk(assignmentId);
  if (!assignment) throw Object.assign(new Error('Assignment not found'), { status: 404, code: 'NOT_FOUND' });

  if (workingPatternId !== undefined) {
    const newPattern = await WorkingPattern.findByPk(workingPatternId);
    if (!newPattern || !newPattern.is_active) {
      throw Object.assign(new Error('This working pattern is not active and cannot be assigned.'), { status: 400, code: 'WORKING_PATTERN_INACTIVE' });
    }
  }

  const newFrom = effectiveFrom !== undefined ? new Date(effectiveFrom) : new Date(assignment.effective_from);
  const newToRaw = effectiveTo !== undefined ? effectiveTo : assignment.effective_to;
  const newTo = newToRaw ? new Date(newToRaw) : null;

  const existing = await WorkingPatternAssignment.findAll({
    where: { employee_id: assignment.employee_id, assignment_id: { [Op.ne]: assignmentId } },
  });
  assertNoOverlap(existing, newFrom, newTo);

  const priorValue = { working_pattern_id: assignment.working_pattern_id, effective_from: assignment.effective_from, effective_to: assignment.effective_to };
  if (workingPatternId !== undefined) assignment.working_pattern_id = workingPatternId;
  if (effectiveFrom !== undefined) assignment.effective_from = effectiveFrom;
  if (effectiveTo !== undefined) assignment.effective_to = effectiveTo || null;
  await assignment.save();

  await auditService.record({
    actorId, action: 'WORKING_PATTERN_ASSIGNMENT_UPDATED', entityType: 'working_pattern_assignments', entityId: assignmentId,
    priorValue, newValue: { workingPatternId, effectiveFrom, effectiveTo },
  });
  return assignment;
}

/**
 * Returns the weekend day-code set that applies to this employee on this date:
 * their active working pattern if one covers the date, otherwise null (caller
 * falls back to the organisation-wide default).
 */
async function getWeekendOverrideForDate(employeeId, isoDate) {
  const assignment = await WorkingPatternAssignment.findOne({
    where: {
      employee_id: employeeId,
      effective_from: { [Op.lte]: isoDate },
      [Op.or]: [{ effective_to: null }, { effective_to: { [Op.gte]: isoDate } }],
    },
    include: [WorkingPattern],
  });
  if (!assignment) return null;
  return JSON.parse(assignment.WorkingPattern.weekend_days);
}

module.exports = { listPatterns, listAssignments, createPattern, assignPattern, updateAssignment, getWeekendOverrideForDate, deactivatePattern, reactivatePattern };
