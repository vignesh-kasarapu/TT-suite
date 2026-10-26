const reportsService = require('../services/reports.service');
const { AuditLog, Employee } = require('../models');
const { ok } = require('../utils/apiResponse');

async function leaveTaken(req, res) {
  const scope = req.currentUser.roles.includes('HR_ADMIN') ? 'HR' : 'MANAGER';
  const rows = await reportsService.leaveTakenReport({ ...req.query, scope, viewerId: req.currentUser.employeeId });
  return ok(res, rows);
}

async function lop(req, res) {
  const rows = await reportsService.lopReport(req.query);
  return ok(res, rows);
}

async function balances(req, res) {
  const rows = await reportsService.balancesReport(req.query);
  return ok(res, rows);
}

/** LMS-080: HR/Admin views and filters the audit log (R2). */
async function auditLog(req, res) {
  const { Op } = require('sequelize');
  const { actorId, action, entityType, from, to } = req.query;
  const where = {};
  if (actorId) where.actor_id = actorId;
  if (action) where.action = action;
  if (entityType) where.entity_type = entityType;
  if (from || to) where.timestamp = {};
  if (from) where.timestamp[Op.gte] = from;
  if (to) where.timestamp[Op.lte] = to;

  const rows = await AuditLog.findAll({
    where,
    // NOTE: Employee.full_name is a DataTypes.VIRTUAL getter with no declared field
    // dependencies, so asking the include for only ['full_name'] makes Sequelize
    // select zero real columns from the joined `users` row — the association then
    // comes back empty (no `actor` key at all) in the live response. Requesting the
    // underlying columns the getter reads forces them to be selected so it resolves.
    include: [{ model: Employee, as: 'actor', attributes: ['full_name', 'first_name', 'last_name', 'employee_code'] }],
    order: [['timestamp', 'DESC']],
    limit: 200,
  });
  return ok(res, rows);
}

module.exports = { leaveTaken, lop, balances, auditLog };
