const { Notification } = require('../models');

/** LMS-068: every notification is written in-app; this reads that channel back for the recipient. */
async function listForEmployee(employeeId, { unreadOnly } = {}) {
  const where = { recipient_id: employeeId, channel: 'IN_APP' };
  if (unreadOnly) where.read_at = null;
  return Notification.findAll({ where, order: [['created_at', 'DESC']], limit: 100 });
}

async function unreadCount(employeeId) {
  return Notification.count({ where: { recipient_id: employeeId, channel: 'IN_APP', read_at: null } });
}

async function markRead(notificationId, employeeId) {
  const notification = await Notification.findByPk(notificationId);
  if (!notification || String(notification.recipient_id) !== String(employeeId)) {
    throw Object.assign(new Error('Notification not found'), { status: 404, code: 'NOT_FOUND' });
  }
  notification.read_at = new Date();
  await notification.save();
  return notification;
}

async function markAllRead(employeeId) {
  await Notification.update(
    { read_at: new Date() },
    { where: { recipient_id: employeeId, channel: 'IN_APP', read_at: null } },
  );
  return { updated: true };
}

module.exports = { listForEmployee, unreadCount, markRead, markAllRead };
