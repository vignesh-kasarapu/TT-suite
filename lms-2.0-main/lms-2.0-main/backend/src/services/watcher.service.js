const { Op } = require('sequelize');
const { Watcher, StandingWatcher, Employee, LeaveRequest } = require('../models');
const approvalRouting = require('./approvalRouting.service');
const auditService = require('./audit.service');
const notificationService = require('./notification.service');

/** LMS-063: a Watcher must hold Manager or HR/Admin — never Employee-only. */
async function assertEligibleWatcher(employeeId) {
  const isManager = await approvalRouting.hasRole(employeeId, 'MANAGER');
  const isHrAdmin = await approvalRouting.hasRole(employeeId, 'HR_ADMIN');
  if (!isManager && !isHrAdmin) {
    throw Object.assign(
      new Error('Only a Manager or HR/Admin can be added as a Watcher.'),
      { status: 400, code: 'INELIGIBLE_WATCHER' },
    );
  }
}

/** LMS-060: a Manager adds a Watcher to a specific request within their reporting line. */
async function addWatcher({ requestId, watcherEmployeeId, addedById, addedByIsHrAdmin }) {
  const request = await LeaveRequest.findByPk(requestId);
  if (!request) throw Object.assign(new Error('Request not found'), { status: 404 });

  if (!addedByIsHrAdmin) {
    const employeeService = require('./employee.service');
    const inHierarchy = await employeeService.isInManagerHierarchy(addedById, request.employee_id);
    if (!inHierarchy) {
      throw Object.assign(
        new Error('You can only add a watcher to a request raised by someone in your own reporting line.'),
        { status: 403, code: 'NOT_IN_HIERARCHY' },
      );
    }
  }

  await assertEligibleWatcher(watcherEmployeeId);

  const existing = await Watcher.findOne({ where: { request_id: requestId, watcher_employee_id: watcherEmployeeId } });
  if (existing) return existing; // idempotent add

  const watcher = await Watcher.create({ request_id: requestId, watcher_employee_id: watcherEmployeeId, added_by_id: addedById });
  await auditService.record({ actorId: addedById, action: 'WATCHER_ADDED', entityType: 'watchers', entityId: watcher.watcher_id, newValue: { requestId, watcherEmployeeId } });
  return watcher;
}

/**
 * Roles doc §2.9: "Manager: Add/remove Watcher on team requests; HR/Admin: same Org-wide."
 * A Manager may only remove a watcher from a request raised by someone in their own
 * reporting line (any depth); HR/Admin may remove from any request.
 */
async function removeWatcher({ requestId, watcherId, removedById, removedByIsHrAdmin }) {
  const watcher = await Watcher.findByPk(watcherId);
  if (!watcher || String(watcher.request_id) !== String(requestId)) {
    throw Object.assign(new Error('Watcher not found on this request.'), { status: 404, code: 'NOT_FOUND' });
  }

  if (!removedByIsHrAdmin) {
    const request = await LeaveRequest.findByPk(requestId);
    const employeeService = require('./employee.service');
    const inHierarchy = await employeeService.isInManagerHierarchy(removedById, request.employee_id);
    if (!inHierarchy) {
      throw Object.assign(
        new Error('You can only remove a watcher from a request raised by someone in your own reporting line.'),
        { status: 403, code: 'NOT_IN_HIERARCHY' },
      );
    }
  }

  await auditService.record({ actorId: removedById, action: 'WATCHER_REMOVED', entityType: 'watchers', entityId: watcherId, priorValue: { requestId, watcherEmployeeId: watcher.watcher_employee_id } });
  await watcher.destroy();
  return { removed: true };
}

/** LMS-061: standing Watcher on a direct/indirect report (Manager) or any employee (HR/Admin). */
async function addStandingWatcher({ watchedEmployeeId, watcherEmployeeId, fromDate, toDate, addedById, addedByIsHrAdmin }) {
  await assertEligibleWatcher(watcherEmployeeId);

  if (!addedByIsHrAdmin) {
    const employeeService = require('./employee.service');
    const inHierarchy = await employeeService.isInManagerHierarchy(addedById, watchedEmployeeId);
    if (!inHierarchy) {
      throw Object.assign(
        new Error('You can only set a standing watcher on your own direct or indirect reports.'),
        { status: 403, code: 'NOT_IN_HIERARCHY' },
      );
    }
  }

  // Reject a duplicate/overlapping standing-watcher entry for the same
  // (watched, watcher) pair — a date range overlaps when it starts on or
  // before the new range's end AND ends on or after the new range's start.
  const overlapping = await StandingWatcher.findOne({
    where: {
      watched_employee_id: watchedEmployeeId,
      watcher_employee_id: watcherEmployeeId,
      from_date: { [Op.lte]: toDate },
      to_date: { [Op.gte]: fromDate },
    },
  });
  if (overlapping) {
    throw Object.assign(
      new Error('This employee already has a standing watcher assignment for an overlapping date range.'),
      { status: 400, code: 'DUPLICATE_STANDING_WATCHER' },
    );
  }

  const standing = await StandingWatcher.create({
    watched_employee_id: watchedEmployeeId, watcher_employee_id: watcherEmployeeId,
    from_date: fromDate, to_date: toDate, added_by_id: addedById,
  });
  await auditService.record({ actorId: addedById, action: 'STANDING_WATCHER_ADDED', entityType: 'standing_watchers', entityId: standing.standing_watcher_id, newValue: { watchedEmployeeId, watcherEmployeeId, fromDate, toDate } });
  return standing;
}

async function listStandingWatchers(watchedEmployeeId, viewerId, viewerIsHrAdmin) {
  if (!viewerIsHrAdmin) {
    const employeeService = require('./employee.service');
    const inHierarchy = await employeeService.isInManagerHierarchy(viewerId, watchedEmployeeId);
    if (!inHierarchy) {
      throw Object.assign(
        new Error('You can only view standing watchers for your own direct or indirect reports.'),
        { status: 403, code: 'NOT_IN_HIERARCHY' },
      );
    }
  }
  return StandingWatcher.findAll({
    where: { watched_employee_id: watchedEmployeeId },
    include: [{ model: Employee, as: 'watcherEmployee', attributes: ['full_name'] }],
    order: [['from_date', 'DESC']],
  });
}

/**
 * LMS-062: every active Standing Watcher for this employee auto-applies to a
 * newly submitted request as a normal Watcher row — this must run at submit
 * time, not just exist as a schedule the UI can query.
 */
async function applyStandingWatchers(request, transaction) {
  const standing = await StandingWatcher.findAll({
    where: {
      watched_employee_id: request.employee_id,
      from_date: { [Op.lte]: request.start_date },
      to_date: { [Op.gte]: request.start_date },
    },
    transaction,
  });
  for (const s of standing) {
    const existing = await Watcher.findOne({ where: { request_id: request.request_id, watcher_employee_id: s.watcher_employee_id }, transaction });
    if (existing) continue;
    await Watcher.create({
      request_id: request.request_id, watcher_employee_id: s.watcher_employee_id, added_by_id: s.added_by_id,
    }, { transaction });
  }
}

/**
 * Notification matrix §6.5 "To Watchers" — every watcher on a request gets
 * notified of submit/approve/reject/cancel, subject to BR-42 masking (the
 * notification itself never names the leave type or reason; that masking
 * lives in the detail-view query layer, not here — this just says "a
 * watched request was <event>", which is already safe to send as-is).
 */
async function notifyWatchers(requestId, templateKey, transaction) {
  const watchers = await Watcher.findAll({ where: { request_id: requestId }, transaction });
  for (const w of watchers) {
    await notificationService.notify({
      recipientId: w.watcher_employee_id, templateKey, relatedRequestId: requestId, transaction,
    });
  }
}

module.exports = {
  addWatcher, removeWatcher, addStandingWatcher, listStandingWatchers, assertEligibleWatcher,
  applyStandingWatchers, notifyWatchers,
};
