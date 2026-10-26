const leaveRequestService = require('../services/leaveRequest.service');
const { ok, created } = require('../utils/apiResponse');

async function preview(req, res) {
  const { leaveTypeId, startDate, endDate, isHalfDay } = req.query;
  const result = await leaveRequestService.previewApplication({
    employeeId: req.currentUser.employeeId,
    leaveTypeId,
    startDate,
    endDate,
    isHalfDay: isHalfDay === 'true',
  });
  return ok(res, result);
}

async function submit(req, res) {
  const { leaveTypeId, startDate, endDate, isHalfDay, halfDayPortion, reason } = req.body;
  const request = await leaveRequestService.submitRequest({
    employeeId: req.currentUser.employeeId,
    leaveTypeId, startDate, endDate, isHalfDay, halfDayPortion, reason,
  });
  return created(res, request);
}

async function decide(req, res) {
  const { decision, reason } = req.body;
  const request = await leaveRequestService.decide({
    requestId: req.params.requestId,
    actorId: req.currentUser.employeeId,
    decision,
    reason,
  });
  return ok(res, request);
}

async function withdraw(req, res) {
  const request = await leaveRequestService.withdraw({
    requestId: req.params.requestId,
    employeeId: req.currentUser.employeeId,
  });
  return ok(res, request);
}

async function requestCancellation(req, res) {
  const request = await leaveRequestService.requestCancellation({
    requestId: req.params.requestId,
    employeeId: req.currentUser.employeeId,
  });
  return ok(res, request);
}

async function decideCancellation(req, res) {
  const { decision, unelapsedDays } = req.body;
  const request = await leaveRequestService.decideCancellation({
    requestId: req.params.requestId,
    actorId: req.currentUser.employeeId,
    decision,
    unelapsedDays,
  });
  return ok(res, request);
}

async function myRequests(req, res) {
  const { LeaveRequest, LeaveType, Employee } = require('../models');
  const requests = await LeaveRequest.findAll({
    where: { employee_id: req.currentUser.employeeId },
    include: [
      { model: LeaveType, attributes: ['type_name', 'type_code'] },
      // So the requester can see WHO currently holds their pending request (e.g. after an
      // SLA escalation moved it up a level) without a separate lookup — surfaced in the UI
      // as "Pending with: <name>".
      { model: Employee, as: 'currentApprover', attributes: ['full_name', 'first_name', 'last_name', 'employee_code'] },
    ],
    order: [['created_at', 'DESC']],
  });
  return ok(res, requests);
}

/**
 * NFR-13/BR-42: full request detail is visible only to the employee, their
 * approvers in the chain (any past approval actor, or the current approver),
 * and HR/Admin. A Watcher gets a masked projection instead — dates, status,
 * leave type (Sick rendered as "Unavailable") — and never reason/attachments.
 * Anyone else is refused outright. Masking is applied here, at the query/
 * service layer, never left for the client to hide (§10.2 of the Workflows
 * doc is explicit that a masked value must never reach the client).
 */
async function getScopedDetail({ requestId, viewerId, viewerIsHrAdmin }) {
  const { LeaveRequest, LeaveType, LeaveRequestApproval, Watcher, Employee, LeaveRequestAttachment } = require('../models');

  const request = await LeaveRequest.findByPk(requestId, {
    include: [
      { model: LeaveType },
      { model: LeaveRequestApproval, as: 'approvals' },
      { model: Watcher, as: 'watchers', include: [{ model: Employee, as: 'watcherEmployee', attributes: ['full_name'] }] },
      { model: Employee, as: 'employee', attributes: ['full_name', 'employee_code'] },
      { model: Employee, as: 'currentApprover', attributes: ['full_name', 'first_name', 'last_name', 'employee_code'] },
      { model: LeaveRequestAttachment, as: 'attachments', attributes: ['attachment_id', 'file_name', 'content_type', 'size_bytes', 'uploaded_at'] },
    ],
  });
  if (!request) return null;

  const isOwner = String(request.employee_id) === String(viewerId);
  const isCurrentApprover = String(request.current_approver_id) === String(viewerId);
  const hasApprovedInChain = request.approvals.some((a) => String(a.actor_id) === String(viewerId));
  const isFullAccess = isOwner || viewerIsHrAdmin || isCurrentApprover || hasApprovedInChain;

  if (isFullAccess) return { scope: 'FULL', request: request.toJSON() };

  const isWatcher = request.watchers.some((w) => String(w.watcher_employee_id) === String(viewerId));
  if (!isWatcher) return { scope: 'DENIED', request: null };

  // Masked projection for a Watcher: dates, status, day-count, type (Sick masked)
  // — never reason/attachments. deducted_days is a day COUNT (not the reason or
  // leave-type detail), so it's safe to include per BR-42.
  const masked = {
    request_id: request.request_id,
    start_date: request.start_date,
    end_date: request.end_date,
    state: request.state,
    deducted_days: request.deducted_days,
    employee: request.employee,
    LeaveType: request.LeaveType.is_sick_leave ? { type_name: 'Unavailable' } : { type_name: request.LeaveType.type_name },
  };
  return { scope: 'WATCHER_MASKED', request: masked };
}

async function detail(req, res) {
  const result = await getScopedDetail({
    requestId: req.params.requestId,
    viewerId: req.currentUser.employeeId,
    viewerIsHrAdmin: req.currentUser.roles.includes('HR_ADMIN'),
  });
  if (!result || result.scope === 'DENIED') {
    return res.status(403).json({ success: false, error: { code: 'PERMISSION_DENIED', message: 'You do not have access to this request.' } });
  }
  // Include `scope` alongside the request fields so the client can tell a
  // masked (WATCHER_MASKED) response apart from a genuinely-empty field on a
  // FULL response, rather than guessing from field presence alone.
  return ok(res, { ...result.request, scope: result.scope });
}

async function approvalsQueue(req, res) {
  const { LeaveRequest, LeaveType, Employee, Delegation } = require('../models');
  const { Op } = require('sequelize');
  const isHrAdmin = req.currentUser.roles.includes('HR_ADMIN');

  // current_approver_id only identifies a specific PERSON — that fits the Manager stage
  // (routed to a manager or their active delegate) and a cancellation decision (routed the
  // same way), but PENDING_HR is a ROLE grant, not a person, and is never assigned an
  // individual's id — every HR/Admin must see every PENDING_HR request, not just a
  // current_approver_id match (which would never be true for anyone).
  const scopeClauses = [
    { current_approver_id: req.currentUser.employeeId, state: { [Op.in]: ['PENDING_MANAGER', 'CANCELLATION_REQUESTED'] } },
  ];
  if (isHrAdmin) {
    scopeClauses.push({ state: 'PENDING_HR' });
    // A cancellation request from an employee with no manager on record (top-of-hierarchy
    // self-approver) has no current_approver_id to route to — HR/Admin is the fallback.
    scopeClauses.push({ state: 'CANCELLATION_REQUESTED', current_approver_id: null });
  }

  const requests = await LeaveRequest.findAll({
    where: { [Op.or]: scopeClauses },
    include: [
      { model: LeaveType, attributes: ['type_name'] },
      { model: Employee, as: 'employee', attributes: ['full_name', 'first_name', 'last_name', 'employee_code', 'reporting_manager_id', 'designation'] },
    ],
    order: [['sla_started_at', 'ASC']],
  });

  // A delegated request is identified from the delegation that was active
  // when the request was submitted. This remains true even if the delegation
  // is revoked later, because the request was already routed to this user.
  const delegations = await Delegation.findAll({
    where: { delegate_id: req.currentUser.employeeId },
    include: [{ model: Employee, as: 'nominator', attributes: ['full_name', 'employee_code'] }],
  });

  const result = requests.map((request) => {
    const submittedAt = new Date(request.application_timestamp || request.createdAt);
    const delegation = delegations.find((candidate) => (
      String(candidate.nominator_id) === String(request.employee?.reporting_manager_id)
      && new Date(candidate.from_date) <= submittedAt
      && new Date(candidate.to_date) >= submittedAt
    ));

    return {
      ...request.toJSON(),
      is_delegated: Boolean(delegation),
      delegated_for: delegation?.nominator || null,
      decision_type: request.state === 'CANCELLATION_REQUESTED' ? 'CANCELLATION' : 'REQUEST',
    };
  });

  return ok(res, result);
}

async function addWatcher(req, res) {
  const watcherService = require('../services/watcher.service');
  const watcher = await watcherService.addWatcher({
    requestId: req.params.requestId, watcherEmployeeId: req.body.watcherEmployeeId, addedById: req.currentUser.employeeId,
    addedByIsHrAdmin: req.currentUser.roles.includes('HR_ADMIN'),
  });
  return created(res, watcher);
}

async function removeWatcher(req, res) {
  const watcherService = require('../services/watcher.service');
  const result = await watcherService.removeWatcher({
    requestId: req.params.requestId, watcherId: req.params.watcherId,
    removedById: req.currentUser.employeeId, removedByIsHrAdmin: req.currentUser.roles.includes('HR_ADMIN'),
  });
  return ok(res, result);
}

async function saveDraft(req, res) {
  const request = await leaveRequestService.saveDraft({ ...req.body, employeeId: req.currentUser.employeeId });
  return created(res, request);
}

async function updateDraft(req, res) {
  const request = await leaveRequestService.updateDraft({ ...req.body, requestId: req.params.requestId, employeeId: req.currentUser.employeeId });
  return ok(res, request);
}

async function discardDraft(req, res) {
  const result = await leaveRequestService.discardDraft({ requestId: req.params.requestId, employeeId: req.currentUser.employeeId });
  return ok(res, result);
}

async function submitDraft(req, res) {
  const request = await leaveRequestService.submitDraft({ requestId: req.params.requestId, employeeId: req.currentUser.employeeId });
  return ok(res, request);
}

module.exports = {
  preview, submit, decide, withdraw, requestCancellation, decideCancellation,
  myRequests, detail, approvalsQueue, addWatcher, removeWatcher,
  saveDraft, updateDraft, discardDraft, submitDraft,
};
