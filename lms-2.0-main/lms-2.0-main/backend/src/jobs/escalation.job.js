const { Op } = require('sequelize');
const {
  LeaveRequest, Employee, LeaveType, ScheduledJobRun, LopRecord,
} = require('../models');
const configService = require('../services/config.service');
const notificationService = require('../services/notification.service');
const auditService = require('../services/audit.service');

/** BR-34: reminder N days before the SLA deadline. BR-35/36: escalate one level up on breach, terminate at HR/Admin. */
async function runSlaSweep() {
  const { Notification } = require('../models');
  const slaDays = await configService.get('approval.sla_working_days');
  const reminderDaysBefore = await configService.get('approval.sla_reminder_days_before');

  const pending = await LeaveRequest.findAll({ where: { state: { [Op.in]: ['PENDING_MANAGER', 'PENDING_HR'] } } });

  for (const request of pending) {
    if (!request.sla_started_at) continue;
    const elapsedMs = Date.now() - new Date(request.sla_started_at).getTime();
    const slaMs = slaDays * 24 * 60 * 60 * 1000;
    const remainingDays = (slaMs - elapsedMs) / (24 * 60 * 60 * 1000);

    if (elapsedMs >= slaMs) {
      await escalateOneLevel(request);
    } else if (remainingDays <= reminderDaysBefore) {
      // A reminder already exists for this stage if one was sent since the SLA clock last
      // started (sla_started_at resets on every escalation) — without this check, a request
      // sitting in the 75%-100% band gets re-notified on every cron tick.
      const alreadyReminded = await Notification.findOne({
        where: {
          related_request_id: request.request_id,
          template_key: 'SLA_REMINDER',
          created_at: { [Op.gte]: request.sla_started_at },
        },
      });
      if (alreadyReminded) continue;

      await notificationService.notify({
        recipientId: request.current_approver_id,
        templateKey: 'SLA_REMINDER',
        tokens: { requestId: request.request_id },
        relatedRequestId: request.request_id,
      });
    }
  }
}

async function escalateOneLevel(request) {
  const currentApprover = await Employee.findByPk(request.current_approver_id);
  const nextApprover = currentApprover?.reporting_manager_id
    ? await Employee.findByPk(currentApprover.reporting_manager_id)
    : null;

  const priorApproverId = request.current_approver_id;

  // BR-36: escalation terminates at HR/Admin; self-approval never results from escalation.
  request.current_approver_id = nextApprover ? nextApprover.employee_id : await findHrAdminQueueId();
  request.sla_started_at = new Date();
  await request.save();

  await auditService.record({
    isSystemActor: true, action: 'SLA_ESCALATED', entityType: 'leave_requests', entityId: request.request_id,
    priorValue: { current_approver_id: priorApproverId }, newValue: { current_approver_id: request.current_approver_id },
  });

  // Resolved by ID rather than reused from `nextApprover` so the name is available even in the
  // HR-fallback branch (findHrAdminQueueId only returns an ID) — both the prior approver and the
  // requester need to know WHO it escalated to, not just that it moved.
  const newApprover = await Employee.findByPk(request.current_approver_id);
  const newApproverName = newApprover?.full_name || 'HR/Admin';

  await notificationService.notify({
    recipientId: priorApproverId, templateKey: 'ESCALATION_NOTICE_TO_PRIOR_APPROVER',
    tokens: { requestId: request.request_id, newApproverName },
    relatedRequestId: request.request_id,
  });
  await notificationService.notify({
    recipientId: request.current_approver_id, templateKey: 'NEW_REQUEST_AWAITING_DECISION',
    relatedRequestId: request.request_id,
  });
  // The requester themselves was never told their request moved at all until now — without
  // this they'd only discover an escalation happened by noticing a new name in the (previously
  // empty) approval timeline, with no explanation of what changed or why.
  await notificationService.notify({
    recipientId: request.employee_id, templateKey: 'REQUEST_ESCALATED',
    tokens: { requestId: request.request_id, newApproverName },
    relatedRequestId: request.request_id,
  });
}

async function findHrAdminQueueId() {
  const { EmployeeRole, Role } = require('../models');
  // Only route to an active HR_ADMIN — a deactivated employee's role grant is never a valid
  // escalation target. Order deterministically (lowest employee_id first) so the same admin
  // is picked consistently across escalations rather than whatever order the DB happens to return.
  const hrAdmin = await EmployeeRole.findOne({
    include: [
      { model: Role, where: { role_code: 'HR_ADMIN' } },
      { model: Employee, where: { is_active: true } }, // `status` is a VIRTUAL getter over is_active — unusable in a WHERE clause
    ],
    order: [['employee_id', 'ASC']],
  });
  return hrAdmin ? hrAdmin.employee_id : null;
}

/** BR-18 to BR-20: convert expired advance-leave rejections to LOP. Idempotent per request
 * (checked via LopRecord below) — the job_run row is just an audit trail of each sweep, so
 * its key includes the time, not just the date, or a legitimate same-day rerun would collide
 * on the (job_type, period_key) unique index and fail before ever reaching the per-request check. */
async function runLopConversionSweep() {
  const periodKey = new Date().toISOString();
  const jobRun = await ScheduledJobRun.create({ job_type: 'LOP_CONVERSION', period_key: periodKey, status: 'RUNNING' });

  try {
    const expired = await LeaveRequest.findAll({
      where: { state: 'REJECTED_PENDING_WITHDRAWAL', withdrawal_window_end: { [Op.lt]: new Date() } },
    });

    const lopType = await LeaveType.findOne({ where: { is_system: true, type_code: 'LOP' } });

    for (const request of expired) {
      const alreadyConverted = await LopRecord.findOne({ where: { request_id: request.request_id } });
      if (alreadyConverted) continue; // idempotent

      const priorTypeId = request.leave_type_id;
      request.prior_leave_type_id = priorTypeId;
      request.leave_type_id = lopType.leave_type_id;
      request.state = 'LOP_APPLIED';
      await request.save();

      await LopRecord.create({
        request_id: request.request_id,
        employee_id: request.employee_id,
        prior_leave_type_id: priorTypeId,
        lop_leave_type_id: lopType.leave_type_id,
        start_date: request.start_date,
        end_date: request.end_date,
        deducted_days: request.deducted_days,
        converted_at: new Date(),
        converted_by_job_run_id: jobRun.job_run_id,
      });

      await auditService.record({
        isSystemActor: true, action: 'LOP_CONVERSION', entityType: 'leave_requests', entityId: request.request_id,
        priorValue: { leave_type_id: priorTypeId, state: 'REJECTED_PENDING_WITHDRAWAL' },
        newValue: { leave_type_id: lopType.leave_type_id, state: 'LOP_APPLIED' },
      });

      await notificationService.notify({
        recipientId: request.employee_id, templateKey: 'LOSS_OF_PAY_APPLIED', relatedRequestId: request.request_id,
      });
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

module.exports = { runSlaSweep, runLopConversionSweep, escalateOneLevel };
