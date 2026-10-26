const service = require('../services/notificationCentre.service');
const { ok } = require('../utils/apiResponse');

async function list(req, res) {
  const rows = await service.listForEmployee(req.currentUser.employeeId, { unreadOnly: req.query.unreadOnly === 'true' });
  return ok(res, rows);
}

async function unreadCount(req, res) {
  const count = await service.unreadCount(req.currentUser.employeeId);
  return ok(res, { count });
}

async function markRead(req, res) {
  const notification = await service.markRead(req.params.notificationId, req.currentUser.employeeId);
  return ok(res, notification);
}

async function markAllRead(req, res) {
  const result = await service.markAllRead(req.currentUser.employeeId);
  return ok(res, result);
}

module.exports = { list, unreadCount, markRead, markAllRead };
