require('dotenv').config();
const sequelize = require('../config/database');
const {
  Role, ManagementLevel, LeaveType, LeavePolicy, LeaveAccrualConfig, LeaveYear, NotificationTemplate,
} = require('../models');
const configService = require('../services/config.service');

async function seed() {
  await sequelize.authenticate();
  await sequelize.sync();

  // roles: EMPLOYEE, MANAGER, HR_ADMIN
  await Promise.all([
    Role.findOrCreate({ where: { role_code: 'EMPLOYEE' }, defaults: { role_name: 'Employee' } }),
    Role.findOrCreate({ where: { role_code: 'MANAGER' }, defaults: { role_name: 'Manager' } }),
    Role.findOrCreate({ where: { role_code: 'HR_ADMIN' }, defaults: { role_name: 'HR / Admin' } }),
  ]);

  // management_levels: org L1..Ln with level_rank
  for (const [code, rank] of [['L1', 1], ['L2', 2], ['L3', 3], ['L4', 4], ['L5', 5]]) {
    await ManagementLevel.findOrCreate({ where: { level_code: code }, defaults: { level_name: `Level ${rank}`, level_rank: rank } });
  }

  // leave_types: LOP (system) + org types; SICK marked via is_sick_leave
  const types = [
    { type_code: 'ANNUAL', type_name: 'Annual Leave', permits_half_day: true, permits_attachments: false, entitlement: 24, carries_forward: true, cap: 10, accrual: 'MONTHLY' },
    { type_code: 'SICK', type_name: 'Sick Leave', is_sick_leave: true, permits_half_day: true, permits_attachments: true, entitlement: 9, carries_forward: false, accrual: 'MONTHLY' },
    { type_code: 'CASUAL', type_name: 'Casual Leave', permits_half_day: true, permits_attachments: false, entitlement: 15, carries_forward: false, accrual: 'QUARTERLY' },
    { type_code: 'MATERNITY', type_name: 'Maternity Leave', permits_half_day: false, permits_attachments: true, entitlement: 182, carries_forward: false, accrual: 'ANNUAL' },
    { type_code: 'BEREAVEMENT', type_name: 'Bereavement Leave', permits_half_day: false, permits_attachments: false, entitlement: 5, carries_forward: false, accrual: 'ANNUAL' },
  ];
  for (const t of types) {
    const [leaveType] = await LeaveType.findOrCreate({
      where: { type_code: t.type_code },
      defaults: {
        type_name: t.type_name, is_sick_leave: !!t.is_sick_leave, is_balance_affecting: true,
        permits_half_day: t.permits_half_day, permits_attachments: t.permits_attachments,
      },
    });
    await LeavePolicy.findOrCreate({
      where: { leave_type_id: leaveType.leave_type_id },
      defaults: { annual_entitlement: t.entitlement, carries_forward: t.carries_forward, carry_forward_cap: t.cap || null },
    });
    await LeaveAccrualConfig.findOrCreate({
      where: { leave_type_id: leaveType.leave_type_id },
      defaults: { accrual_method: t.accrual, posting_day: 1 },
    });
  }
  // LMS-025: non-deletable LOP type, not selectable by employee, not balance-affecting.
  await LeaveType.findOrCreate({
    where: { type_code: 'LOP' },
    defaults: {
      type_name: 'Loss of Pay', is_system: true, is_balance_affecting: false, is_selectable_by_employee: false,
      permits_half_day: false, permits_attachments: false,
    },
  });

  // R3/LMS-083: COMP_OFF is balance-affecting and employee-selectable (unlike LOP) — it's
  // earned time off, credited by compOff.service.js against approved out-of-hours work.
  await LeaveType.findOrCreate({
    where: { type_code: 'COMP_OFF' },
    defaults: {
      type_name: 'Compensatory Off', is_system: false, is_balance_affecting: true, is_selectable_by_employee: true,
      permits_half_day: true, permits_attachments: false,
    },
  });

  // leave_years: current year is_current=true (default 1 Apr - 31 Mar)
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  await LeaveYear.findOrCreate({
    where: { year_code: `${startYear}-${startYear + 1}` },
    defaults: { start_date: `${startYear}-04-01`, end_date: `${startYear + 1}-03-31`, is_current: true },
  });

  // organization_configs seed (system actor = employee_id 0 sentinel avoided; use null-safe first HR admin later)
  await configService.seedDefaults(null);

  // notification_templates: FRD Section 6 event keys
  const templates = [
    ['REQUEST_SUBMITTED_CONFIRMATION', 'Your leave request has been submitted', 'Your request for {{days}} day(s) from {{startDate}} to {{endDate}} has been submitted.'],
    ['REQUEST_AWAITING_DECISION', 'Leave request awaiting your decision', '{{employeeName}} has requested {{days}} day(s) leave from {{startDate}} to {{endDate}}.'],
    ['NEW_REQUEST_AWAITING_DECISION', 'A request has moved to your queue', 'A leave request now requires your decision.'],
    ['REQUEST_APPROVED', 'Your leave request was approved', 'Your leave request has been approved.'],
    ['REQUEST_REJECTED', 'Your leave request was rejected', 'Your leave request was rejected. Reason: {{reason}}'],
    ['SLA_REMINDER', 'Reminder: a leave request is awaiting your decision', 'Request #{{requestId}} is approaching its SLA deadline.'],
    ['ESCALATION_NOTICE_TO_PRIOR_APPROVER', 'A request escalated past your queue', 'A leave request has escalated to the next level after breaching SLA. It is now with {{newApproverName}}.'],
    ['REQUEST_ESCALATED', 'Your leave request moved to a new approver', 'Your leave request #{{requestId}} was not actioned within the SLA window and has escalated. It is now with {{newApproverName}}.'],
    ['CANCELLATION_REQUEST_AWAITING_DECISION', 'Cancellation request awaiting your decision', '{{employeeName}} has requested cancellation of an approved leave.'],
    ['CANCELLATION_APPROVED', 'Your cancellation was approved', 'Your leave cancellation has been approved.'],
    ['CANCELLATION_REJECTED', 'Your cancellation was rejected', 'Your leave cancellation request was rejected.'],
    ['BALANCE_ADJUSTED', 'Your leave balance was adjusted', 'Your balance was adjusted by {{quantity}} day(s). Reason: {{reason}}'],
    ['LOSS_OF_PAY_APPLIED', 'Loss of pay applied', 'Your withdrawal window expired; the request has been converted to Loss of Pay.'],
    ['DELEGATE_ASSIGNED_TO_YOU', 'Delegation update', 'A delegation involving you has been set from {{nominatorId}} to {{delegateId}}.'],
    ['SELF_APPROVAL_GRANTED', 'Self-approval permission granted', 'HR/Admin has granted you self-approval permission for leave requests, effective where no higher authority exists.'],
    ['MANAGER_REASSIGNED', 'Reporting line updated', 'A reporting-manager change has taken effect. New manager: employee #{{newManagerId}}.'],
    ['LEAVE_ENCASHMENT_POSTED', 'Leave encashment posted', '{{daysEncashed}} day(s) of leave have been encashed and recorded for payroll.'],
    ['COMP_OFF_CREDITED', 'Compensatory off credited', '{{hoursOrDays}} day(s) of compensatory off have been credited for your work on {{workDate}}.'],
    ['WATCHED_REQUEST_SUBMITTED', 'A watched request was submitted', 'A leave request you are watching has been submitted.'],
    ['WATCHED_REQUEST_APPROVED', 'A watched request was approved', 'A leave request you are watching has been approved.'],
    ['WATCHED_REQUEST_REJECTED', 'A watched request was rejected', 'A leave request you are watching has been rejected.'],
    ['WATCHED_REQUEST_CANCELLED', 'A watched request was cancelled', 'A leave request you are watching has been cancelled.'],
    ['LONG_LEAVE_SUPERVISOR_NOTICE', 'Long leave submitted in your reporting line', '{{employeeName}}\'s request has entered second-stage (HR) approval. This is notification only — you have no approval authority over it.'],
    ['EXTENDED_SICK_LEAVE_ALERT', 'Extended sick leave', '{{employeeName}} has an extended sick leave request ({{days}} day(s)).'],
    ['CARRY_FORWARD_APPLIED', 'Carry-forward applied', 'Your leave-year rollover is complete: {{carried}} day(s) carried forward, {{lapsed}} day(s) lapsed.'],
    ['EMPLOYEE_ONBOARDING_INVITE', 'Welcome to LMS — sign in to get started', 'Hi {{fullName}}, your employee record has been created. Sign in at {{signInUrl}} using your work email with your Microsoft account (single sign-on) to access the system.'],
  ];
  for (const [key, subject, body] of templates) {
    await NotificationTemplate.findOrCreate({ where: { template_key: key }, defaults: { subject_template: subject, body_template: body } });
  }

  // eslint-disable-next-line no-console
  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
