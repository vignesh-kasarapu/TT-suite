const { Op } = require('sequelize');
const { Employee, Delegation, EmployeeRole, Role } = require('../models');
const approvalRouting = require('./approvalRouting.service');
const auditService = require('./audit.service');
const notificationService = require('./notification.service');

/**
 * LMS-041: eligible delegates are peer Managers — same management_level_id,
 * reporting to the same supervisor as the nominating Manager. Where no such
 * peer exists, falls back to the nominating Manager's own supervisor.
 * The system computes and returns only valid choices — never a free search.
 */
async function getEligibleDelegates(nominatorId) {
  const nominator = await Employee.findByPk(nominatorId);
  if (!nominator) throw Object.assign(new Error('Employee not found'), { status: 404 });

  const peers = await Employee.findAll({
    where: {
      reporting_manager_id: nominator.reporting_manager_id,
      management_level_id: nominator.management_level_id,
      employee_id: { [Op.ne]: nominatorId },
    },
  });

  const peerManagers = [];
  for (const peer of peers) {
    if (await approvalRouting.hasRole(peer.employee_id, 'MANAGER')) peerManagers.push(peer);
  }

  if (peerManagers.length > 0) return { candidates: peerManagers, fallbackUsed: false };

  // No peer exists — fall back to the nominating Manager's own supervisor.
  if (nominator.reporting_manager_id) {
    const supervisor = await Employee.findByPk(nominator.reporting_manager_id);
    return { candidates: supervisor ? [supervisor] : [], fallbackUsed: true };
  }
  return { candidates: [], fallbackUsed: true };
}

/** HR/Admin picker: only same-supervisor, same-level Managers are eligible.
 * Unlike the manager self-service flow, HR must not receive the supervisor
 * fallback as a delegate option.
 */
async function getEligiblePeerManagers(nominatorId) {
  const nominator = await Employee.findByPk(nominatorId);
  if (!nominator) throw Object.assign(new Error('Manager not found'), { status: 404 });
  if (!nominator.management_level_id) return [];

  const peers = await Employee.findAll({
    where: {
      reporting_manager_id: nominator.reporting_manager_id,
      management_level_id: nominator.management_level_id,
      employee_id: { [Op.ne]: nominatorId },
    },
    order: [['first_name', 'ASC'], ['last_name', 'ASC']],
  });

  const candidates = [];
  for (const peer of peers) {
    if (await approvalRouting.hasRole(peer.employee_id, 'MANAGER')) candidates.push(peer);
  }
  return candidates;
}

async function listManagers() {
  const employees = await Employee.findAll({ order: [['first_name', 'ASC'], ['last_name', 'ASC']] });
  const managers = [];
  for (const employee of employees) {
    if (await approvalRouting.hasRole(employee.employee_id, 'MANAGER')) managers.push(employee);
  }
  return managers;
}

/** getFirstStageApprover picks a single active delegation for a nominator via a date-range
 * lookup with no tie-break — two overlapping windows would make routing non-deterministic. */
async function assertNoDelegationOverlap(nominatorId, fromDate, toDate) {
  const existing = await Delegation.findAll({ where: { nominator_id: nominatorId, revoked_at: null } });
  const newFrom = new Date(fromDate);
  const newTo = new Date(toDate);
  const overlaps = existing.some((d) => newFrom <= new Date(d.to_date) && newTo >= new Date(d.from_date));
  if (overlaps) {
    throw Object.assign(
      new Error('This manager already has an active delegation covering part of this date range. Delegation windows may not overlap.'),
      { status: 400, code: 'DELEGATION_OVERLAP' },
    );
  }
}

/** LMS-041: a Manager nominates a Delegate for a defined date range, from the eligible list only. */
async function nominate({ nominatorId, delegateId, fromDate, toDate, setById, allowFallback = true }) {
  const candidates = allowFallback
    ? (await getEligibleDelegates(nominatorId)).candidates
    : await getEligiblePeerManagers(nominatorId);
  const isEligible = candidates.some((c) => String(c.employee_id) === String(delegateId));
  if (!isEligible) {
    throw Object.assign(
      new Error('This employee is not an eligible delegate (must be a peer manager under the same supervisor, or the supervisor where no peer exists).'),
      { status: 400, code: 'INELIGIBLE_DELEGATE' },
    );
  }
  await assertNoDelegationOverlap(nominatorId, fromDate, toDate);

  const delegation = await Delegation.create({
    nominator_id: nominatorId, delegate_id: delegateId, set_by_id: setById, from_date: fromDate, to_date: toDate,
  });

  await auditService.record({ actorId: setById, action: 'DELEGATION_CREATED', entityType: 'delegations', entityId: delegation.delegation_id, newValue: { nominatorId, delegateId, fromDate, toDate } });
  // LMS-041/042: both the Manager and the Delegate are notified.
  await notificationService.notify({ recipientId: nominatorId, templateKey: 'DELEGATE_ASSIGNED_TO_YOU', tokens: { nominatorId, delegateId } });
  await notificationService.notify({ recipientId: delegateId, templateKey: 'DELEGATE_ASSIGNED_TO_YOU', tokens: { nominatorId, delegateId } });

  return delegation;
}

/** LMS-042: a Manager's own supervisor may set a delegate on that Manager's behalf, for emergency cover. */
async function nominateOnBehalf({ supervisorId, nominatorId, delegateId, fromDate, toDate, isHrAdmin = false }) {
  const nominator = await Employee.findByPk(nominatorId);
  if (!nominator) throw Object.assign(new Error('Manager not found'), { status: 404 });
  if (!isHrAdmin && String(nominator.reporting_manager_id) !== String(supervisorId)) {
    throw Object.assign(new Error('You may only set a delegation for your own direct reports.'), { status: 403, code: 'NOT_SUPERVISOR' });
  }
  return nominate({ nominatorId, delegateId, fromDate, toDate, setById: supervisorId, allowFallback: !isHrAdmin });
}

async function revoke(delegationId, actorId, actorIsHrAdmin = false) {
  const delegation = await Delegation.findByPk(delegationId);
  if (!delegation) throw Object.assign(new Error('Delegation not found'), { status: 404 });

  const isOwner = String(delegation.nominator_id) === String(actorId) || String(delegation.set_by_id) === String(actorId);
  if (!isOwner && !actorIsHrAdmin) {
    throw Object.assign(
      new Error('You can only revoke a delegation you nominated or set on someone else\'s behalf.'),
      { status: 403, code: 'NOT_OWNER' },
    );
  }

  delegation.revoked_at = new Date();
  await delegation.save();
  await auditService.record({ actorId, action: 'DELEGATION_REVOKED', entityType: 'delegations', entityId: delegationId });
  return delegation;
}

async function listMine(employeeId) {
  // Employee.full_name is a DataTypes.VIRTUAL getter derived from first_name/last_name — an
  // include that asks for only ['full_name'] selects none of the columns it actually reads,
  // so it silently resolves to nothing useful (same root cause already fixed in listAll()
  // below). Asking for first_name/last_name/employee_code forces Sequelize to select them.
  return Delegation.findAll({
    where: { [Op.or]: [{ nominator_id: employeeId }, { delegate_id: employeeId }] },
    include: [
      { model: Employee, as: 'nominator', attributes: ['full_name', 'first_name', 'last_name', 'employee_code'] },
      { model: Employee, as: 'delegate', attributes: ['full_name', 'first_name', 'last_name', 'employee_code'] },
    ],
    order: [['from_date', 'DESC']],
  });
}

/** Roles doc §2.6: "HR/Admin: R Org (optional visibility)" — every delegation, not just the caller's own. */
async function listAll() {
  // NOTE: Employee.full_name is a DataTypes.VIRTUAL getter with no declared field
  // dependencies, so an include that asks for only ['full_name'] causes Sequelize
  // to select zero real columns from the joined `users` row — the nested
  // nominator/delegate association then comes back empty in the response. Asking
  // for the underlying columns the getter reads (first_name/last_name/employee_code)
  // forces Sequelize to actually select and populate them, so full_name resolves.
  return Delegation.findAll({
    include: [
      { model: Employee, as: 'nominator', attributes: ['full_name', 'first_name', 'last_name', 'employee_code'] },
      { model: Employee, as: 'delegate', attributes: ['full_name', 'first_name', 'last_name', 'employee_code'] },
    ],
    order: [['from_date', 'DESC']],
  });
}

module.exports = { getEligibleDelegates, getEligiblePeerManagers, listManagers, nominate, nominateOnBehalf, revoke, listMine, listAll };
