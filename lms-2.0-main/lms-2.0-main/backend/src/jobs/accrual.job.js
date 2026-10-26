const { Op } = require('sequelize');
const {
  Employee, LeaveType, LeavePolicy, LeaveAccrualConfig, LeaveYear, ScheduledJobRun, LeaveLedger,
} = require('../models');
const balanceService = require('../services/balance.service');

/**
 * BR-13/14/15: pro-rata opening entitlement, rounded UP, posted automatically on onboarding.
 * Accepts an optional `{ transaction }` so a caller creating the employee inside an active
 * transaction (e.g. bulkImport.service.js) can post the opening credit against that same,
 * not-yet-committed employee row instead of it being invisible on another connection.
 */
async function postOpeningProRata(employeeId, options = {}) {
  const { transaction } = options;
  const employee = await Employee.findByPk(employeeId, { transaction });
  const leaveYear = await LeaveYear.findOne({ where: { is_current: true }, transaction });
  const policies = await LeavePolicy.findAll({ include: [{ model: LeaveType, where: { is_balance_affecting: true } }], transaction });

  const periodKey = `${leaveYear.year_code}:${employeeId}`;
  const existing = await ScheduledJobRun.findOne({ where: { job_type: 'ACCRUAL', period_key: `OPENING:${periodKey}` }, transaction });
  if (existing) return; // NFR-16 idempotency guard

  const totalDaysInYear = (new Date(leaveYear.end_date) - new Date(leaveYear.start_date)) / 86400000 + 1;
  const daysFromJoinToYearEnd = (new Date(leaveYear.end_date) - new Date(employee.date_of_joining)) / 86400000 + 1;
  // Clamp to 1.0: an employee who joined before the current leave year started (e.g.
  // a pre-existing employee onboarded into a new leave year) would otherwise produce a
  // ratio > 1 and be credited far more than the annual entitlement.
  const ratio = Math.min(daysFromJoinToYearEnd / totalDaysInYear, 1);

  for (const policy of policies) {
    const raw = policy.annual_entitlement * ratio; // BR-13
    const rounded = Math.ceil(raw); // BR-14: rounds up, deliberate generosity

    await LeaveLedger.create({
      employee_id: employeeId,
      leave_type_id: policy.leave_type_id,
      leave_year_id: leaveYear.leave_year_id,
      entry_type: 'OPENING_PRO_RATA_CREDIT',
      quantity: rounded,
      source_reference: `onboarding:${employeeId}`,
      is_system_actor: true,
    }, { transaction });
  }

  await ScheduledJobRun.create({ job_type: 'ACCRUAL', period_key: `OPENING:${periodKey}`, status: 'SUCCESS', finished_at: new Date() }, { transaction });
}

/** LMS-055: periodic accrual posting, uniquely keyed on (employee, leave type, period) — never double-credits.
 * The job_run row for a given period_key is found-or-created (not always freshly created) so that a
 * retry after a partial failure reuses the existing row instead of colliding on the (job_type,
 * period_key) unique index — the same idiom used by carryForward.job.js and the LOP conversion sweep
 * in escalation.job.js. If a prior run already succeeded for this period, this is a no-op. */
async function runPeriodicAccrual(periodKey) {
  const [jobRun, created] = await ScheduledJobRun.findOrCreate({
    where: { job_type: 'ACCRUAL', period_key: periodKey },
    defaults: { job_type: 'ACCRUAL', period_key: periodKey, status: 'RUNNING' },
  });
  if (!created) {
    if (jobRun.status === 'SUCCESS') return; // already completed for this period — NFR-16 idempotency guard
    jobRun.status = 'RUNNING';
    jobRun.error_message = null;
    await jobRun.save();
  }
  try {
    const leaveYear = await LeaveYear.findOne({ where: { is_current: true } });
    const configs = await LeaveAccrualConfig.findAll({ include: [LeaveType] });
    const policies = await LeavePolicy.findAll();
    // `status` is a VIRTUAL getter over `is_active` (see employee.model.js) — it has no
    // backing column, so it cannot be used in a `where` clause; query the real column instead.
    const employees = await Employee.findAll({ where: { is_active: true } });

    for (const cfg of configs) {
      const policy = policies.find((p) => p.leave_type_id === cfg.leave_type_id);
      if (!policy) continue;
      const periodsPerYear = { MONTHLY: 12, QUARTERLY: 4, ANNUAL: 1 }[cfg.accrual_method];
      const perPeriod = parseFloat(policy.annual_entitlement) / periodsPerYear;

      for (const emp of employees) {
        const uniqueKey = `${periodKey}:${cfg.leave_type_id}:${emp.employee_id}`;
        const already = await LeaveLedger.findOne({ where: { source_reference: uniqueKey } });
        if (already) continue; // idempotent

        await LeaveLedger.create({
          employee_id: emp.employee_id,
          leave_type_id: cfg.leave_type_id,
          leave_year_id: leaveYear.leave_year_id,
          entry_type: 'PERIODIC_ACCRUAL_CREDIT',
          quantity: perPeriod,
          source_reference: uniqueKey,
          is_system_actor: true,
        });
      }
    }
    jobRun.status = 'SUCCESS';
  } catch (err) {
    jobRun.status = 'FAILED';
    jobRun.error_message = err.message;
  } finally {
    jobRun.finished_at = new Date();
    await jobRun.save();
  }
}

module.exports = { postOpeningProRata, runPeriodicAccrual };
