const { sequelize, LeaveEncashmentRequest, LeaveLedger } = require('../models');
const balanceService = require('./balance.service');
const auditService = require('./audit.service');
const notificationService = require('./notification.service');

/**
 * LMS-084: HR-initiated conversion of leave balance into a payable record for
 * downstream payroll. The system performs no salary calculation — this posts
 * a ledger debit for the encashed days (mirroring a leave deduction, since
 * the days leave the balance) and records the encashment as a distinct,
 * auditable entity so payroll can find exactly what was encashed and when.
 */
async function requestEncashment({ employeeId, leaveTypeId, leaveYearId, daysEncashed, requestedBy, notes }) {
  const normalizedDays = Number(daysEncashed);
  if (!Number.isFinite(normalizedDays) || normalizedDays <= 0) {
    throw Object.assign(
      new Error('daysEncashed must be a positive number.'),
      { status: 400, code: 'INVALID_DAYS_ENCASHED' },
    );
  }

  return sequelize.transaction(async (transaction) => {
    const balance = await balanceService.getEffectiveBalance(employeeId, leaveTypeId, leaveYearId);
    if (normalizedDays > balance.effectiveBalance) {
      throw Object.assign(
        new Error(`Cannot encash ${normalizedDays} day(s) — effective balance is only ${balance.effectiveBalance}.`),
        { status: 400, code: 'INSUFFICIENT_BALANCE' },
      );
    }

    const ledgerEntry = await LeaveLedger.create({
      employee_id: employeeId, leave_type_id: leaveTypeId, leave_year_id: leaveYearId,
      entry_type: 'MANUAL_ADJUSTMENT', quantity: -normalizedDays,
      source_reference: 'leave_encashment', actor_id: requestedBy,
      reason: notes || 'Leave encashment',
    }, { transaction });

    const encashment = await LeaveEncashmentRequest.create({
      employee_id: employeeId, leave_type_id: leaveTypeId, leave_year_id: leaveYearId,
      days_encashed: normalizedDays, ledger_entry_id: ledgerEntry.entry_id, status: 'POSTED',
      requested_by: requestedBy, notes,
    }, { transaction });

    await auditService.record({
      actorId: requestedBy, action: 'LEAVE_ENCASHMENT_POSTED', entityType: 'leave_encashment_requests',
      entityId: encashment.encashment_id, newValue: { employeeId, leaveTypeId, daysEncashed: normalizedDays }, transaction,
    });

    await notificationService.notify({
      recipientId: employeeId, templateKey: 'LEAVE_ENCASHMENT_POSTED', tokens: { daysEncashed: normalizedDays }, transaction,
    }).catch(() => {});

    return encashment;
  });
}

async function listForEmployee(employeeId) {
  return LeaveEncashmentRequest.findAll({ where: { employee_id: employeeId }, order: [['requested_at', 'DESC']] });
}

module.exports = { requestEncashment, listForEmployee };
