const { Op } = require('sequelize');
const { LeaveLedger, LeaveYear, Employee, LeaveType } = require('../models');
const balanceService = require('../services/balance.service');
const auditService = require('../services/audit.service');
const notificationService = require('../services/notification.service');
const { ok, created } = require('../utils/apiResponse');

function withRunningBalance(entries) {
  let running = 0;
  return entries.map((e) => {
    running += parseFloat(e.quantity);
    return { ...e.toJSON(), running_balance: running };
  });
}

/** Builds a where clause that only includes filters the caller actually supplied — an
 * explicit `undefined` in a Sequelize where clause is a query error, not "no filter". */
async function buildLedgerWhere(employeeId, leaveTypeId, leaveYearId) {
  const where = { employee_id: employeeId };
  if (leaveTypeId) where.leave_type_id = leaveTypeId;
  if (leaveYearId) {
    where.leave_year_id = leaveYearId;
  } else {
    // No year specified — default to the current leave year rather than
    // silently returning every year's entries mixed together.
    const current = await LeaveYear.findOne({ where: { is_current: true } });
    if (current) where.leave_year_id = current.leave_year_id;
  }
  return where;
}

/** LMS-057: an employee's full ledger, every entry with type/quantity/running balance/source/timestamp. */
async function myLedger(req, res) {
  const { leaveTypeId, leaveYearId } = req.query;
  const where = await buildLedgerWhere(req.currentUser.employeeId, leaveTypeId, leaveYearId);
  const entries = await LeaveLedger.findAll({ where, order: [['created_at', 'ASC']] });
  return ok(res, withRunningBalance(entries));
}

/** §7.3.17: HR/Admin views any employee's full ledger — the balance-adjustment screen shows this inline. */
async function employeeLedger(req, res) {
  const { leaveTypeId, leaveYearId } = req.query;
  const where = await buildLedgerWhere(req.params.employeeId, leaveTypeId, leaveYearId);
  const entries = await LeaveLedger.findAll({ where, order: [['created_at', 'ASC']] });
  return ok(res, withRunningBalance(entries));
}

/** HR/Admin cross-employee ledger view — every existing endpoint above is scoped to one
 * employee ("me" or a single :employeeId); this is the "all transactions, with filters"
 * admin screen. Paginated, most recent first. */
async function allEntries(req, res) {
  const {
    employeeId, leaveTypeId, leaveYearId, entryType, dateFrom, dateTo, page = 1, pageSize = 50,
  } = req.query;

  const where = {};
  if (employeeId) where.employee_id = employeeId;
  if (leaveTypeId) where.leave_type_id = leaveTypeId;
  if (leaveYearId) where.leave_year_id = leaveYearId;
  if (entryType) where.entry_type = entryType;
  if (dateFrom || dateTo) {
    where.created_at = {};
    if (dateFrom) where.created_at[Op.gte] = new Date(dateFrom);
    if (dateTo) where.created_at[Op.lte] = new Date(`${dateTo}T23:59:59.999Z`);
  }

  const limit = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);
  const currentPage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (currentPage - 1) * limit;

  const { count, rows } = await LeaveLedger.findAndCountAll({
    where,
    include: [
      { model: Employee, attributes: ['employee_id', 'first_name', 'last_name', 'full_name', 'employee_code'] },
      { model: LeaveType, attributes: ['type_name', 'type_code'] },
    ],
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  return ok(res, { total: count, page: currentPage, pageSize: limit, entries: rows });
}

/** LMS-054: HR/Admin manual adjustment — signed quantity + mandatory reason, never silent. */
async function adjust(req, res) {
  const { employeeId, leaveTypeId, leaveYearId, quantity, reason } = req.body;

  const entry = await balanceService.writeManualAdjustment({
    employeeId, leaveTypeId, leaveYearId, quantity, reason, actorId: req.currentUser.employeeId,
  });

  await auditService.record({
    actorId: req.currentUser.employeeId, action: 'BALANCE_ADJUSTED', entityType: 'leave_ledger',
    entityId: entry.entry_id, newValue: { quantity, reason },
  });

  await notificationService.notify({
    recipientId: employeeId, templateKey: 'BALANCE_ADJUSTED', tokens: { quantity, reason },
  });

  return created(res, entry);
}

module.exports = { myLedger, employeeLedger, allEntries, adjust };
