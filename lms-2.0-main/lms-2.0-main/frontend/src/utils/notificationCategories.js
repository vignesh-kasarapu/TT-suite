/** Notification categories for the notification centre.
 *
 * Grouping lives here, not on the server: a category is a presentation choice derived
 * entirely from `template_key`, and keeping it client-side avoids a migration and a
 * second place for the two to disagree.
 *
 * ORDER is deliberate — what needs an action from you first, what merely informs you
 * last. HR can create their own notification templates, so anything unrecognised falls
 * into OTHER rather than vanishing from the list.
 */
export const CATEGORIES = {
  ACTION: {
    key: 'ACTION',
    label: 'Awaiting your decision',
    hint: 'Requests that need you to approve or reject',
  },
  ESCALATION: {
    key: 'ESCALATION',
    label: 'Reminders & escalations',
    hint: 'SLA reminders and requests that moved up the reporting line',
  },
  MY_REQUESTS: {
    key: 'MY_REQUESTS',
    label: 'Your requests',
    hint: 'Outcomes on leave you applied for',
  },
  BALANCE: {
    key: 'BALANCE',
    label: 'Loss of pay & balance',
    hint: 'Anything that changed your leave balance or pay',
  },
  TEAM: {
    key: 'TEAM',
    label: 'Team alerts',
    hint: 'Notice-only alerts about people in your reporting line',
  },
  WATCHING: {
    key: 'WATCHING',
    label: 'Requests you watch',
    hint: 'Updates on requests you were added to as a watcher',
  },
  ACCOUNT: {
    key: 'ACCOUNT',
    label: 'Access & org changes',
    hint: 'Delegations, role grants and reporting-line changes',
  },
  OTHER: {
    key: 'OTHER',
    label: 'Other',
    hint: 'Notifications from templates added after this grouping was written',
  },
};

export const CATEGORY_ORDER = [
  'ACTION', 'ESCALATION', 'MY_REQUESTS', 'BALANCE', 'TEAM', 'WATCHING', 'ACCOUNT', 'OTHER',
];

const BY_TEMPLATE = {
  REQUEST_AWAITING_DECISION: 'ACTION',
  NEW_REQUEST_AWAITING_DECISION: 'ACTION',
  CANCELLATION_REQUEST_AWAITING_DECISION: 'ACTION',

  SLA_REMINDER: 'ESCALATION',
  ESCALATION_NOTICE_TO_PRIOR_APPROVER: 'ESCALATION',
  REQUEST_ESCALATED: 'ESCALATION',

  REQUEST_SUBMITTED_CONFIRMATION: 'MY_REQUESTS',
  REQUEST_APPROVED: 'MY_REQUESTS',
  REQUEST_REJECTED: 'MY_REQUESTS',
  CANCELLATION_APPROVED: 'MY_REQUESTS',
  CANCELLATION_REJECTED: 'MY_REQUESTS',

  LOSS_OF_PAY_APPLIED: 'BALANCE',
  BALANCE_ADJUSTED: 'BALANCE',
  CARRY_FORWARD_APPLIED: 'BALANCE',
  LEAVE_ENCASHMENT_POSTED: 'BALANCE',
  COMP_OFF_CREDITED: 'BALANCE',

  EXTENDED_SICK_LEAVE_ALERT: 'TEAM',
  LONG_LEAVE_SUPERVISOR_NOTICE: 'TEAM',

  WATCHED_REQUEST_SUBMITTED: 'WATCHING',
  WATCHED_REQUEST_APPROVED: 'WATCHING',
  WATCHED_REQUEST_REJECTED: 'WATCHING',
  WATCHED_REQUEST_CANCELLED: 'WATCHING',

  DELEGATE_ASSIGNED_TO_YOU: 'ACCOUNT',
  SELF_APPROVAL_GRANTED: 'ACCOUNT',
  MANAGER_REASSIGNED: 'ACCOUNT',
  EMPLOYEE_ONBOARDING_INVITE: 'ACCOUNT',
};

export const categoryOf = (notification) =>
  CATEGORIES[BY_TEMPLATE[notification?.template_key] || 'OTHER'];

/** Returns the categories actually present, in ORDER, each with its notifications and
 * unread count. Empty categories are left out so the filter never offers a dead chip. */
export function groupByCategory(notifications) {
  const buckets = new Map();
  for (const n of notifications) {
    const key = categoryOf(n).key;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(n);
  }
  return CATEGORY_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    ...CATEGORIES[key],
    items: buckets.get(key),
    unread: buckets.get(key).filter((n) => !n.read_at).length,
  }));
}
