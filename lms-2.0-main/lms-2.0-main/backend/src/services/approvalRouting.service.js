const { Op } = require('sequelize');
const { addDays, format } = require('date-fns');
const {
  Employee, LeaveRequest, Delegation, SelfApprovalPermission, EmployeeRole, Role,
} = require('../models');
const configService = require('./config.service');

/** Role assignment rule: self-approval is prohibited in any capacity, including as delegate/HR. */
function assertNotSelfApproval(actorId, subjectEmployeeId) {
  if (String(actorId) === String(subjectEmployeeId)) {
    throw Object.assign(
      new Error('You cannot approve, reject, or otherwise act on your own leave request, in any capacity.'),
      { status: 403, code: 'SELF_APPROVAL_BLOCKED' },
    );
  }
}

/** BR-22: first-stage approver is the employee's Manager, or that Manager's active Delegate. */
async function getFirstStageApprover(employee, onDate = new Date()) {
  const managerId = employee.reporting_manager_id;
  if (!managerId) return null;

  const activeDelegation = await Delegation.findOne({
    where: {
      nominator_id: managerId,
      from_date: { [Op.lte]: onDate },
      to_date: { [Op.gte]: onDate },
      revoked_at: null,
    },
  });

  return {
    approverId: activeDelegation ? activeDelegation.delegate_id : managerId,
    onBehalfOfId: activeDelegation ? managerId : null,
  };
}

/**
 * BR-24: aggregate contiguous requests (zero deducted working days apart), Pending/Approved only,
 * to decide whether the long-leave (BR-23) or sick-leave (BR-43/44) threshold is crossed.
 * Sick-type days only aggregate with Sick-type days (BR-44). "Zero deducted working days apart"
 * means the gap between two spans (a weekend, a holiday, or nothing at all) contains no day
 * that would itself count as a deducted working day for this employee — not merely that the
 * two date ranges overlap, which would miss e.g. two 5-day spans separated by a single weekend.
 */
async function getContiguousAggregateDays(employeeId, leaveTypeId, candidateStart, candidateEnd, { sickOnly = false, leaveYearId = null } = {}) {
  const where = {
    employee_id: employeeId,
    state: { [Op.in]: ['PENDING_MANAGER', 'PENDING_HR', 'APPROVED'] },
  };
  if (sickOnly) where.leave_type_id = leaveTypeId; // only same (Sick) type aggregates for BR-44

  const candidates = await LeaveRequest.findAll({ where });
  const candStart = new Date(candidateStart);
  const candEnd = new Date(candidateEnd);
  // Lazy require: businessDayService doesn't depend on this module, but avoids a top-level
  // require cycle risk if that ever changes.
  const businessDayService = require('./businessDay.service');

  let total = 0;
  for (const r of candidates) {
    const rStart = new Date(r.start_date);
    const rEnd = new Date(r.end_date);
    const overlaps = rEnd >= candStart && rStart <= candEnd;

    let isContiguous = overlaps;
    if (!overlaps && leaveYearId) {
      const gapStart = rEnd < candStart ? addDays(rEnd, 1) : addDays(candEnd, 1);
      const gapEnd = rEnd < candStart ? addDays(candStart, -1) : addDays(rStart, -1);
      if (gapStart > gapEnd) {
        isContiguous = true; // the two spans are back-to-back with no day between them
      } else {
        const gapBreakdown = await businessDayService.computeDeductionBreakdown({
          startDate: format(gapStart, 'yyyy-MM-dd'), endDate: format(gapEnd, 'yyyy-MM-dd'),
          isHalfDay: false, leaveYearId, employeeId,
        });
        isContiguous = gapBreakdown.deductedWorkingDays === 0;
      }
    }

    if (isContiguous) total += parseFloat(r.deducted_days || 0);
  }
  return total;
}

/**
 * BR-23: does this request (post-aggregation) require HR/Admin second-stage approval?
 * `aggregateDays` is the sum of OTHER contiguous requests (never includes this candidate's
 * own days — see getContiguousAggregateDays), so the two must be added together to get the
 * combined contiguous total; taking the max of the two would let two requests that are each
 * individually under the threshold combine to exceed it without ever being detected.
 */
async function requiresLongLeaveSecondStage(deductedDays, aggregateDays) {
  const threshold = await configService.get('approval.long_leave_threshold_days');
  return (deductedDays + aggregateDays) > threshold;
}

/**
 * R1 Addendum (table 37): controlled self-approval.
 * Grants only apply when the employee has an active grant AND no valid higher authority exists.
 * "No valid higher authority" = no reporting manager AND escalation would exhaust the hierarchy.
 */
async function isEligibleForSelfApproval(employee, onDate = new Date()) {
  const grant = await SelfApprovalPermission.findOne({
    where: {
      employee_id: employee.employee_id,
      is_active: true,
      effective_from: { [Op.lte]: onDate },
      [Op.or]: [{ effective_to: null }, { effective_to: { [Op.gte]: onDate } }],
    },
  });
  if (!grant) return false;

  const hasHigherAuthority = Boolean(employee.reporting_manager_id);
  return !hasHigherAuthority;
}

/**
 * BR-37 precondition check used at hierarchy-entry time (LMS-011), not at escalation time.
 * Accepts an optional `{ transaction }` so callers that are wiring up a manager inside an
 * active Sequelize transaction (e.g. bulkImport.service.js, which may have written earlier
 * rows' reporting_manager_id in this same batch) get walk results that reflect those
 * in-progress, not-yet-committed writes rather than only what's already been committed.
 */
async function wouldCreateCircularHierarchy(employeeId, proposedManagerId, options = {}) {
  const { transaction } = options;
  let cursor = proposedManagerId;
  const seen = new Set();
  while (cursor) {
    if (String(cursor) === String(employeeId)) return true;
    if (seen.has(cursor)) return true; // defensive: pre-existing cycle
    seen.add(cursor);
    const mgr = await Employee.findByPk(cursor, { transaction });
    cursor = mgr ? mgr.reporting_manager_id : null;
  }
  return false;
}

/** EMPLOYEE/MANAGER/HR_ADMIN are all explicit grants checked via employee_roles. */
async function hasRole(employeeId, roleCode) {
  const count = await EmployeeRole.count({
    include: [{ model: Role, where: { role_code: roleCode }, attributes: [] }],
    where: { employee_id: employeeId },
  });
  return count > 0;
}

module.exports = {
  assertNotSelfApproval,
  getFirstStageApprover,
  getContiguousAggregateDays,
  requiresLongLeaveSecondStage,
  isEligibleForSelfApproval,
  wouldCreateCircularHierarchy,
  hasRole,
};
