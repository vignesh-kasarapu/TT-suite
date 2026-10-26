const { Op } = require('sequelize');
const {
  Employee, LeaveType, LeavePolicy, LeaveYear, LeaveLedger, ScheduledJobRun,
} = require('../models');
const balanceService = require('../services/balance.service');
const notificationService = require('../services/notification.service');
const auditService = require('../services/audit.service');

/**
 * LMS-056/BR-27: at leave-year end, for each employee × carry-forward-enabled
 * leave type, posts a carry-forward credit up to the configured cap and a
 * lapse debit for the excess. Idempotent per (employee, leave type, closing
 * year) via the unique job-run tracking below — a rerun for a year already
 * closed out is a no-op, matching NFR-16.
 */
async function runYearEndCarryForward(closingLeaveYearId) {
  // The job_run row is an audit trail of each attempt, not the idempotency mechanism
  // itself — that lives in the per-employee `source_reference` uniqueness check below.
  // Keying this on the closing year alone would make a legitimate rerun (e.g. after a
  // partial failure) collide on the (job_type, period_key) unique index before ever
  // reaching that check — the same class of bug already fixed once in the LOP job.
  const periodKey = `CARRY_FORWARD:${closingLeaveYearId}:${new Date().toISOString()}`;
  const jobRun = await ScheduledJobRun.create({ job_type: 'CARRY_FORWARD', period_key: periodKey, status: 'RUNNING' });

  try {
    const closingYear = await LeaveYear.findByPk(closingLeaveYearId);
    if (closingYear.is_closed) {
      jobRun.status = 'SUCCESS';
      jobRun.error_message = 'No-op: leave year is already closed.';
      jobRun.finished_at = new Date();
      await jobRun.save();
      return;
    }
    const nextYear = await LeaveYear.findOne({ where: { start_date: { [Op.gt]: closingYear.end_date } }, order: [['start_date', 'ASC']] });
    if (!nextYear) throw new Error('No next leave year exists to carry forward into. Create it before running this job.');

    const policies = await LeavePolicy.findAll({ where: { carries_forward: true }, include: [LeaveType] });
    const employees = await Employee.findAll({ where: { is_active: true } });

    for (const policy of policies) {
      for (const emp of employees) {
        const uniqueKey = `carry_forward:${closingLeaveYearId}:${policy.leave_type_id}:${emp.employee_id}`;
        const already = await LeaveLedger.findOne({ where: { source_reference: uniqueKey } });
        if (already) continue; // idempotent

        const balance = await balanceService.getLedgerBalance(emp.employee_id, policy.leave_type_id, closingLeaveYearId);
        if (balance <= 0) continue;

        const cap = policy.carry_forward_cap != null ? parseFloat(policy.carry_forward_cap) : balance;
        const carried = Math.min(balance, cap);
        const lapsed = balance - carried;

        if (carried > 0) {
          await LeaveLedger.create({
            employee_id: emp.employee_id, leave_type_id: policy.leave_type_id, leave_year_id: nextYear.leave_year_id,
            entry_type: 'CARRY_FORWARD_CREDIT', quantity: carried, source_reference: uniqueKey, is_system_actor: true,
          });
        }
        if (lapsed > 0) {
          await LeaveLedger.create({
            employee_id: emp.employee_id, leave_type_id: policy.leave_type_id, leave_year_id: closingLeaveYearId,
            entry_type: 'CARRY_FORWARD_LAPSE_DEBIT', quantity: -lapsed, source_reference: uniqueKey, is_system_actor: true,
          });
        }

        await auditService.record({
          isSystemActor: true, action: 'CARRY_FORWARD_APPLIED', entityType: 'employees', entityId: emp.employee_id,
          newValue: { leaveTypeId: policy.leave_type_id, carried, lapsed },
        });
        await notificationService.notify({
          recipientId: emp.employee_id, templateKey: 'CARRY_FORWARD_APPLIED', tokens: { carried, lapsed },
        }).catch(() => {});
      }
    }

    // Mark the closing year closed — BR-01/BR-28: a closed year is never modified again.
    closingYear.is_closed = true;
    closingYear.is_current = false;
    await closingYear.save();
    nextYear.is_current = true;
    await nextYear.save();

    jobRun.status = 'SUCCESS';
  } catch (err) {
    jobRun.status = 'FAILED';
    jobRun.error_message = err.message;
  } finally {
    jobRun.finished_at = new Date();
    await jobRun.save();
  }
}

module.exports = { runYearEndCarryForward };
