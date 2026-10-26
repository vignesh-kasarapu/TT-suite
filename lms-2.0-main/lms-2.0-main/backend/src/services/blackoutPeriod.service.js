const { Op } = require('sequelize');
const { BlackoutPeriod } = require('../models');
const auditService = require('./audit.service');

/** `includeInactive` is admin-screen-only — every business-logic caller (blackout
 * conflict checks) must keep seeing active periods only. */
async function listBlackoutPeriods({ includeInactive = false } = {}) {
  return BlackoutPeriod.findAll({ where: includeInactive ? {} : { is_active: true }, order: [['start_date', 'ASC']] });
}

/** LMS-085 follow-up: an inverted range (end before start) would silently create a
 * blackout period that can never match assertNoBlackoutConflict's query — the admin
 * thinks a blackout is configured but it blocks nothing. Reject it outright. */
function assertValidDateRange(startDate, endDate) {
  if (startDate && endDate && endDate < startDate) {
    throw Object.assign(
      new Error('End date cannot be before start date.'),
      { status: 400, code: 'INVALID_DATE_RANGE' },
    );
  }
}

async function createBlackoutPeriod({ name, startDate, endDate, leaveTypeId }, actorId) {
  assertValidDateRange(startDate, endDate);
  const period = await BlackoutPeriod.create({
    name, start_date: startDate, end_date: endDate, leave_type_id: leaveTypeId || null, created_by: actorId,
  });
  await auditService.record({ actorId, action: 'BLACKOUT_PERIOD_CREATED', entityType: 'blackout_periods', entityId: period.blackout_id, newValue: { name, startDate, endDate, leaveTypeId } });
  return period;
}

async function updateBlackoutPeriod(blackoutId, { name, startDate, endDate, leaveTypeId }, actorId) {
  const period = await BlackoutPeriod.findByPk(blackoutId);
  if (!period) throw Object.assign(new Error('Blackout period not found'), { status: 404, code: 'NOT_FOUND' });
  const prior = { name: period.name, start_date: period.start_date, end_date: period.end_date, leave_type_id: period.leave_type_id };

  assertValidDateRange(startDate ?? period.start_date, endDate ?? period.end_date);

  period.name = name ?? period.name;
  period.start_date = startDate ?? period.start_date;
  period.end_date = endDate ?? period.end_date;
  period.leave_type_id = leaveTypeId !== undefined ? (leaveTypeId || null) : period.leave_type_id;
  await period.save();

  await auditService.record({ actorId, action: 'BLACKOUT_PERIOD_UPDATED', entityType: 'blackout_periods', entityId: blackoutId, priorValue: prior, newValue: { name, startDate, endDate, leaveTypeId } });
  return period;
}

async function setActive(blackoutId, isActive, actorId) {
  const period = await BlackoutPeriod.findByPk(blackoutId);
  if (!period) throw Object.assign(new Error('Blackout period not found'), { status: 404, code: 'NOT_FOUND' });
  period.is_active = isActive;
  await period.save();
  await auditService.record({ actorId, action: isActive ? 'BLACKOUT_PERIOD_REACTIVATED' : 'BLACKOUT_PERIOD_DEACTIVATED', entityType: 'blackout_periods', entityId: blackoutId });
  return period;
}

// Kept for backward compatibility with existing callers — same as setActive(id, false, actorId).
async function deactivate(blackoutId, actorId) { return setActive(blackoutId, false, actorId); }

async function removeBlackoutPeriod(blackoutId, actorId) {
  const period = await BlackoutPeriod.findByPk(blackoutId);
  if (!period) throw Object.assign(new Error('Blackout period not found'), { status: 404, code: 'NOT_FOUND' });
  await period.destroy();
  await auditService.record({ actorId, action: 'BLACKOUT_PERIOD_DELETED', entityType: 'blackout_periods', entityId: blackoutId, priorValue: { name: period.name } });
  return { deleted: true };
}

/**
 * LMS-085: refuses submission where the requested span overlaps an active
 * blackout period for that leave type (or a type-agnostic blackout, where
 * leave_type_id is null — applies to every type). This is a hard block, not
 * a warning, matching the FRD's wording: "leave... may not be applied for."
 */
async function assertNoBlackoutConflict({ leaveTypeId, startDate, endDate }) {
  const conflict = await BlackoutPeriod.findOne({
    where: {
      is_active: true,
      start_date: { [Op.lte]: endDate },
      end_date: { [Op.gte]: startDate },
      [Op.or]: [{ leave_type_id: null }, { leave_type_id: leaveTypeId }],
    },
  });
  if (conflict) {
    throw Object.assign(
      new Error(`This span falls within the blackout period "${conflict.name}" (${conflict.start_date} to ${conflict.end_date}). Leave cannot be applied for during this window.`),
      { status: 400, code: 'BLACKOUT_PERIOD_CONFLICT' },
    );
  }
}

module.exports = {
  listBlackoutPeriods, createBlackoutPeriod, updateBlackoutPeriod, setActive, deactivate,
  removeBlackoutPeriod, assertNoBlackoutConflict,
};
