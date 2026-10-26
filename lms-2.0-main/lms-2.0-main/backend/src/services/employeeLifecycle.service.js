const { Op } = require('sequelize');
const {
  sequelize, Employee, EmployeeFinalSettlement, ManagerReassignmentLog, LeaveType, LeaveYear, LeaveRequest,
  Delegation, EmployeeRole, Role,
} = require('../models');
const balanceService = require('./balance.service');
const auditService = require('./audit.service');
const notificationService = require('./notification.service');
const roleAssignmentService = require('./roleAssignment.service');

/**
 * LMS-016/017: deactivate an employee, recording a last working day, and produce
 * a final settlement position — the balance at that date, prorated. No payment
 * calculation is performed; this is a snapshot for downstream consumption only.
 */
async function deactivate({ employeeId, lastWorkingDay, actorId }) {
  return sequelize.transaction(async (transaction) => {
    const employee = await Employee.findByPk(employeeId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!employee) throw Object.assign(new Error('Employee not found'), { status: 404 });
    if (employee.status === 'DEACTIVATED') {
      throw Object.assign(new Error('Employee is already deactivated.'), { status: 400, code: 'ALREADY_DEACTIVATED' });
    }

    const leaveYear = await LeaveYear.findOne({ where: { is_current: true }, transaction });
    const leaveTypes = await LeaveType.findAll({ where: { is_balance_affecting: true }, transaction });

    const balancesAtSettlement = {};
    for (const lt of leaveTypes) {
      const b = await balanceService.getEffectiveBalance(employeeId, lt.leave_type_id, leaveYear.leave_year_id);
      balancesAtSettlement[lt.type_code] = b;
    }

    const settlement = await EmployeeFinalSettlement.create({
      employee_id: employeeId,
      deactivated_at: lastWorkingDay,
      settlement_snapshot_json: JSON.stringify({ lastWorkingDay, leaveYear: leaveYear.year_code, balances: balancesAtSettlement }),
      created_by: actorId,
    }, { transaction });

    employee.status = 'DEACTIVATED';
    employee.deactivated_at = lastWorkingDay;
    await employee.save({ transaction });

    await auditService.record({
      actorId, action: 'EMPLOYEE_DEACTIVATED', entityType: 'employees', entityId: employeeId,
      newValue: { lastWorkingDay }, transaction,
    });

    // --- Cleanup of things that would otherwise silently keep pointing at a deactivated
    // account (LMS-016/017 follow-up): stuck approvals, stale role grants, and dangling
    // delegations. All within the same transaction as the status flip above, so any
    // failure here (e.g. the last-HR_ADMIN guard) rolls the whole deactivation back
    // rather than leaving the account deactivated with a role grant still attached.

    // (a) Requests currently routed to this employee for a decision would otherwise be
    // stuck forever, since a deactivated employee can no longer log in to act on them.
    // Stopgap only: escalate to the deactivated employee's OWN reporting manager, one
    // level up. This is deliberately NOT a full re-derivation of each request's own
    // first-stage approver (that would mean recomputing routing per request's employee,
    // per approvalRouting.service.js#getFirstStageApprover) — the goal here is "not stuck
    // forever", not "perfectly re-routed". HR can re-route further by hand if needed.
    const stuckRequests = await LeaveRequest.findAll({
      where: {
        current_approver_id: employeeId,
        state: { [Op.in]: ['PENDING_MANAGER', 'PENDING_HR', 'CANCELLATION_REQUESTED'] },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (stuckRequests.length) {
      let escalateToId = employee.reporting_manager_id;
      if (!escalateToId) {
        // No manager to escalate to (e.g. the deactivated employee was at the top of the
        // hierarchy) — fall back to any active HR/Admin rather than leaving the request
        // pointed at an account that can never log in again.
        // `status` is a VIRTUAL getter over `is_active` (employee.model.js) — it has no
        // backing column, so it cannot be used in a `where` clause; query the real column.
        const hrAdminRow = await EmployeeRole.findOne({
          include: [
            { model: Role, where: { role_code: 'HR_ADMIN' }, attributes: [] },
            { model: Employee, where: { is_active: true }, attributes: ['employee_id'] },
          ],
          transaction,
        });
        escalateToId = hrAdminRow ? hrAdminRow.Employee.employee_id : null;
      }

      await LeaveRequest.update(
        { current_approver_id: escalateToId },
        {
          where: { request_id: { [Op.in]: stuckRequests.map((r) => r.request_id) } },
          transaction,
        },
      );

      await auditService.record({
        actorId, action: 'REQUESTS_ESCALATED_ON_DEACTIVATION', entityType: 'leave_requests', entityId: employeeId,
        newValue: { requestIds: stuckRequests.map((r) => r.request_id), newApproverId: escalateToId },
        transaction,
      });
    }

    // (b) Revoke every explicit role grant this employee holds. Routed through
    // roleAssignmentService.revokeRole so the existing "last HR_ADMIN cannot be removed"
    // guard still applies — if it refuses, that error propagates and rolls back the whole
    // deactivation, surfacing a clear message that HR_ADMIN must be reassigned first.
    const roleGrants = await EmployeeRole.findAll({
      where: { employee_id: employeeId },
      include: [{ model: Role, attributes: ['role_code'] }],
      transaction,
    });
    for (const grant of roleGrants) {
      await roleAssignmentService.revokeRole(employeeId, grant.Role.role_code, actorId, { transaction });
    }

    // (c) Revoke delegations naming this employee as either party, so they stop being
    // offered as routing (a delegation to/from a deactivated person should not still read
    // as "active").
    await Delegation.update(
      { revoked_at: new Date() },
      {
        where: {
          [Op.or]: [{ nominator_id: employeeId }, { delegate_id: employeeId }],
          revoked_at: null,
        },
        transaction,
      },
    );

    // Note on orphaned direct reports: employees whose reporting_manager_id still points
    // at this now-deactivated employee are left as-is here. reassignManager (below) is the
    // existing, business-rule-checked tool for HR to fix that by hand; getFirstStageApprover
    // (approvalRouting.service.js) already degrades gracefully for a report whose manager is
    // inactive — it still resolves an approver id from reporting_manager_id (Employee rows
    // aren't filtered by status there), so nothing crashes. Auto-reassigning direct reports
    // to some other manager is a policy decision HR hasn't asked for, so it's out of scope here.

    // Watcher/StandingWatcher rows naming this employee are deliberately left alone — a
    // deactivated watcher simply won't act on new notifications (they can't log in), and no
    // concrete crash/bad-behavior risk was found from leaving that history in place.

    return { employee, settlement };
  });
}

/** LMS-018: reassign an employee to a new manager. Requests already pending with
 * the previous manager remain there unless explicitly transferred — silently
 * moving a pending request to a manager with no context is worse than leaving
 * it, per the FRD's own detail note on this requirement.
 */
async function reassignManager({ employeeId, newManagerId, transferPendingRequests, actorId }) {
  return sequelize.transaction(async (transaction) => {
    const employee = await Employee.findByPk(employeeId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!employee) throw Object.assign(new Error('Employee not found'), { status: 404 });

    const approvalRouting = require('./approvalRouting.service');
    const circular = await approvalRouting.wouldCreateCircularHierarchy(employeeId, newManagerId);
    if (circular) {
      throw Object.assign(new Error('This reassignment would create a circular reporting chain.'), { status: 400, code: 'CIRCULAR_HIERARCHY' });
    }

    const oldManagerId = employee.reporting_manager_id;
    employee.reporting_manager_id = newManagerId;
    await employee.save({ transaction });

    if (transferPendingRequests) {
      await LeaveRequest.update(
        { current_approver_id: newManagerId },
        { where: { employee_id: employeeId, current_approver_id: oldManagerId, state: 'PENDING_MANAGER' }, transaction },
      );
    }

    const log = await ManagerReassignmentLog.create({
      employee_id: employeeId, old_manager_id: oldManagerId, new_manager_id: newManagerId,
      pending_requests_transferred: !!transferPendingRequests, reassigned_by: actorId,
    }, { transaction });

    await auditService.record({
      actorId, action: 'MANAGER_REASSIGNED', entityType: 'employees', entityId: employeeId,
      priorValue: { reporting_manager_id: oldManagerId }, newValue: { reporting_manager_id: newManagerId, transferred: !!transferPendingRequests },
      transaction,
    });

    // Both managers and the employee are notified — explicit, never silent (per the FRD's detail note).
    await notificationService.notify({ recipientId: employeeId, templateKey: 'MANAGER_REASSIGNED', tokens: { newManagerId }, transaction }).catch(() => {});
    if (oldManagerId) await notificationService.notify({ recipientId: oldManagerId, templateKey: 'MANAGER_REASSIGNED', tokens: { newManagerId }, transaction }).catch(() => {});
    await notificationService.notify({ recipientId: newManagerId, templateKey: 'MANAGER_REASSIGNED', tokens: { newManagerId }, transaction }).catch(() => {});

    return log;
  });
}

module.exports = { deactivate, reassignManager };