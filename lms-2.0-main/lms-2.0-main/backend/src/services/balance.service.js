const { LeaveLedger, LeaveRequest } = require('../models');
const { Op } = require('sequelize');

// BR-10: states whose deducted days count against effective balance before approval.
const OPEN_COMMITMENT_STATES = ['PENDING_MANAGER', 'PENDING_HR', 'CANCELLATION_REQUESTED'];

/** BR-07: balance is never stored/mutated directly — always summed from the ledger. */
async function getLedgerBalance(employeeId, leaveTypeId, leaveYearId) {
  const sum = await LeaveLedger.sum('quantity', {
    where: { employee_id: employeeId, leave_type_id: leaveTypeId, leave_year_id: leaveYearId },
  });
  return sum || 0;
}

/** BR-10: effective balance = ledger balance − days committed to open requests. */
async function getEffectiveBalance(employeeId, leaveTypeId, leaveYearId) {
  const ledgerBalance = await getLedgerBalance(employeeId, leaveTypeId, leaveYearId);

  const openRequests = await LeaveRequest.findAll({
    where: {
      employee_id: employeeId,
      leave_type_id: leaveTypeId,
      leave_year_id: leaveYearId,
      state: { [Op.in]: OPEN_COMMITMENT_STATES },
    },
  });
  const committed = openRequests.reduce((sum, r) => sum + parseFloat(r.deducted_days || 0), 0);

  return {
    ledgerBalance: parseFloat(ledgerBalance),
    committedToOpenRequests: committed,
    effectiveBalance: parseFloat(ledgerBalance) - committed,
  };
}

/** BR-09: deduction is written only at the moment a request reaches APPROVED. Never on submission. */
async function writeDeductionEntry({ request, actorId, transaction }) {
  return LeaveLedger.create({
    employee_id: request.employee_id,
    leave_type_id: request.leave_type_id,
    leave_year_id: request.leave_year_id,
    entry_type: 'LEAVE_DEDUCTION_DEBIT',
    quantity: -Math.abs(parseFloat(request.deducted_days)),
    source_reference: `leave_request:${request.request_id}`,
    actor_id: actorId,
    is_system_actor: false,
  }, { transaction });
}

/** BR-31: on cancellation approval, restore only the deducted days not yet elapsed. */
async function writeRestorationEntry({ request, unelapsedDays, actorId, transaction }) {
  return LeaveLedger.create({
    employee_id: request.employee_id,
    leave_type_id: request.leave_type_id,
    leave_year_id: request.leave_year_id,
    entry_type: 'CANCELLATION_RESTORATION_CREDIT',
    quantity: Math.abs(unelapsedDays),
    source_reference: `leave_request:${request.request_id}`,
    actor_id: actorId,
    is_system_actor: false,
  }, { transaction });
}

/** BR-15/BR-54: manual adjustment always requires a reason and is always audited/notified by the caller. */
async function writeManualAdjustment({ employeeId, leaveTypeId, leaveYearId, quantity, reason, actorId, transaction }) {
  if (!reason || !reason.trim()) {
    throw Object.assign(
      new Error('A reason is mandatory for a manual adjustment (BR-15 / LMS-054).'),
      { status: 400, code: 'REASON_REQUIRED' },
    );
  }
  return LeaveLedger.create({
    employee_id: employeeId,
    leave_type_id: leaveTypeId,
    leave_year_id: leaveYearId,
    entry_type: 'MANUAL_ADJUSTMENT',
    quantity,
    source_reference: 'manual_adjustment',
    actor_id: actorId,
    is_system_actor: false,
    reason,
  }, { transaction });
}

module.exports = {
  getLedgerBalance,
  getEffectiveBalance,
  writeDeductionEntry,
  writeRestorationEntry,
  writeManualAdjustment,
  OPEN_COMMITMENT_STATES,
};
