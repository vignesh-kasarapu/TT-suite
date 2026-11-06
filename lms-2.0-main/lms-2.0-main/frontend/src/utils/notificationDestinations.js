/** Where each notification leads: the page where the thing it talks about can actually be
 * seen. My Requests is only for notifications about a leave request; a balance adjustment,
 * an opening balance or a carry-forward is in Reports > Balance history, a comp-off on the
 * Comp-off page, and so on. `scripts/check-notification-links.mjs` (run before every build)
 * fails when a notification the backend sends has no entry here.
 *
 * Each entry: { path, label, short } - or a function of the notification returning one, or
 * null for a notification with nowhere to go. */

const request = (n, fallback) =>
  n.related_request_id
    ? { path: `/my-requests/${n.related_request_id}`, label: 'View this request', short: 'Open request' }
    : fallback;

const APPROVALS = { path: '/approvals', label: 'Open approvals queue', short: 'Approve' };
const MY_REQUESTS = { path: '/my-requests', label: 'Go to my requests', short: 'My requests' };
const BALANCE_HISTORY = { path: '/reports?view=balance-history', label: 'See it in your balance history', short: 'Balance history' };
const RESTRICTIONS = { path: '/reports?view=restrictions', label: 'See held-back days in Reports', short: 'Restrictions' };
const ENCASHMENT = { path: '/reports?view=encashment', label: 'See encashments in Reports', short: 'Encashment' };
const LOP_REPORT = { path: '/reports?view=lop', label: 'See loss of pay in Reports', short: 'Loss of pay' };
const COMP_OFF = { path: '/comp-off', label: 'Open comp-off', short: 'Comp-off' };
const MY_TEAM = { path: '/my-team', label: 'Open my team', short: 'My team' };
const DELEGATION = { path: '/delegation', label: 'Open delegation', short: 'Delegation' };
const DASHBOARD = { path: '/', label: 'Open your dashboard', short: 'Dashboard' };
const EMPLOYEES = { path: '/administration?section=employees', label: 'Open employees', short: 'Employees' };

export const DESTINATIONS = {
  // Somebody else's request needs you.
  REQUEST_AWAITING_DECISION: APPROVALS,
  NEW_REQUEST_AWAITING_DECISION: APPROVALS,
  CANCELLATION_REQUEST_AWAITING_DECISION: APPROVALS,
  SLA_REMINDER: APPROVALS,

  // Your own requests.
  REQUEST_SUBMITTED_CONFIRMATION: (n) => request(n, MY_REQUESTS),
  REQUEST_APPROVED: (n) => request(n, MY_REQUESTS),
  REQUEST_REJECTED: (n) => request(n, MY_REQUESTS),
  CANCELLATION_APPROVED: (n) => request(n, MY_REQUESTS),
  CANCELLATION_REJECTED: (n) => request(n, MY_REQUESTS),
  REQUEST_ESCALATED: (n) => request(n, MY_REQUESTS),
  LOSS_OF_PAY_APPLIED: (n) => request(n, LOP_REPORT),
  ADVANCE_LOP_WARNING: (n) => request(n, DASHBOARD),
  ADVANCE_LOP_ACCEPTED: (n) => request(n, LOP_REPORT),
  ADVANCE_LOP_WITHDRAWN: (n) => request(n, LOP_REPORT),
  ADVANCE_LEAVE_WITHDRAW_WINDOW: (n) => request(n, MY_REQUESTS),

  // Requests you follow (the request page shows a watcher the masked view).
  WATCHED_REQUEST_SUBMITTED: (n) => request(n, null),
  WATCHED_REQUEST_APPROVED: (n) => request(n, null),
  WATCHED_REQUEST_REJECTED: (n) => request(n, null),
  WATCHED_REQUEST_CANCELLED: (n) => request(n, null),

  // Your team's leave (somebody else's request).
  ESCALATION_NOTICE_TO_PRIOR_APPROVER: MY_TEAM,
  LONG_LEAVE_SUPERVISOR_NOTICE: MY_TEAM,
  EXTENDED_SICK_LEAVE_ALERT: MY_TEAM,

  // Your balance: never a request, so never My Requests.
  BALANCE_ADJUSTED: BALANCE_HISTORY,
  CARRY_FORWARD_APPLIED: BALANCE_HISTORY,
  BALANCE_RESTRICTION_CREATED: RESTRICTIONS,
  BALANCE_RESTRICTION_RELEASED: RESTRICTIONS,
  LEAVE_ENCASHMENT_REQUESTED: ENCASHMENT,
  LEAVE_ENCASHMENT_REJECTED: ENCASHMENT,
  LEAVE_ENCASHMENT_POSTED: ENCASHMENT,
  COMP_OFF_REQUESTED: COMP_OFF,
  COMP_OFF_MANAGER_APPROVED: COMP_OFF,
  COMP_OFF_REJECTED: COMP_OFF,
  COMP_OFF_CREDITED: COMP_OFF,

  // Your account.
  DELEGATE_ASSIGNED_TO_YOU: DELEGATION,
  SELF_APPROVAL_GRANTED: DASHBOARD,
  MANAGER_REASSIGNED: DASHBOARD,
  EMPLOYEE_ONBOARDING_INVITE: DASHBOARD,
  EMPLOYEE_JOINED: EMPLOYEES,
};

/** The destination for one notification, or null when it has nowhere to go. */
export function destinationOf(notification) {
  if (!notification) return null;
  const entry = DESTINATIONS[notification.template_key];
  if (entry === undefined) return request(notification, null); // an unknown key: its request, if any
  return typeof entry === 'function' ? entry(notification) : entry;
}
