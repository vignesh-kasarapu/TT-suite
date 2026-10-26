const crypto = require('crypto');
const { Op } = require('sequelize');
const { addDays, format } = require('date-fns');
const { CalendarFeedSubscription, LeaveRequest, Employee } = require('../models');

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Creates a new feed subscription and returns the raw token once — only the hash is stored. */
async function createSubscription(employeeId, scope) {
  const token = generateToken();
  await CalendarFeedSubscription.create({
    employee_id: employeeId, feed_token_hash: hashToken(token), scope,
  });
  return token; // caller builds the subscribable URL with this
}

async function revokeSubscription(subscriptionId, actorId) {
  const sub = await CalendarFeedSubscription.findByPk(subscriptionId);
  if (!sub || String(sub.employee_id) !== String(actorId)) {
    throw Object.assign(new Error('Subscription not found'), { status: 404, code: 'NOT_FOUND' });
  }
  sub.is_active = false;
  sub.revoked_at = new Date();
  await sub.save();
  return sub;
}

async function listSubscriptions(employeeId) {
  return CalendarFeedSubscription.findAll({ where: { employee_id: employeeId } });
}

function formatIcsDate(dateStr) {
  return dateStr.replace(/-/g, '');
}

function escapeIcsText(text) {
  return String(text).replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
}

/**
 * Resolves a raw feed token to its subscription (never trusts an employeeId
 * from the URL — the token itself is the only proof of identity here, since
 * this endpoint deliberately bypasses the normal session cookie so Outlook
 * can poll it unattended).
 */
async function resolveToken(token) {
  const sub = await CalendarFeedSubscription.findOne({ where: { feed_token_hash: hashToken(token), is_active: true } });
  if (!sub) throw Object.assign(new Error('Invalid or revoked calendar feed link.'), { status: 404, code: 'INVALID_CALENDAR_TOKEN' });
  return sub;
}

/** Builds the ICS payload for a resolved subscription — own leave, or team leave for OWN vs TEAM scope. */
async function buildIcsFeed(subscription) {
  let employeeIds = [subscription.employee_id];
  if (subscription.scope === 'TEAM') {
    const reports = await Employee.findAll({ where: { reporting_manager_id: subscription.employee_id } });
    employeeIds = employeeIds.concat(reports.map((r) => r.employee_id));
  }

  const requests = await LeaveRequest.findAll({
    where: { employee_id: { [Op.in]: employeeIds }, state: 'APPROVED' },
    include: [{ model: Employee, as: 'employee', attributes: ['full_name'] }],
  });

  const events = requests.map((r) => [
    'BEGIN:VEVENT',
    `UID:leave-${r.request_id}@lms`,
    `DTSTART;VALUE=DATE:${formatIcsDate(r.start_date)}`,
    // RFC 5545: DTEND on an all-day (VALUE=DATE) event is exclusive — a leave
    // running through end_date inclusive must set DTEND to end_date + 1, or
    // the last day of leave would render as still-working in Outlook.
    `DTEND;VALUE=DATE:${formatIcsDate(format(addDays(new Date(r.end_date), 1), 'yyyy-MM-dd'))}`,
    `SUMMARY:${escapeIcsText(`${r.employee.full_name} — Leave`)}`,
    'END:VEVENT',
  ].join('\r\n'));

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LMS 2.0//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

module.exports = { createSubscription, revokeSubscription, listSubscriptions, resolveToken, buildIcsFeed };
