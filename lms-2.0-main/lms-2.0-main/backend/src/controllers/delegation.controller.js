const delegationService = require('../services/delegation.service');
const { ok, created } = require('../utils/apiResponse');

async function eligibleDelegates(req, res) {
  const result = await delegationService.getEligibleDelegates(req.currentUser.employeeId);
  return ok(res, result);
}

async function managers(req, res) {
  return ok(res, await delegationService.listManagers());
}

async function eligibleForManager(req, res) {
  return ok(res, await delegationService.getEligiblePeerManagers(req.params.nominatorId));
}

async function create(req, res) {
  const { delegateId, fromDate, toDate } = req.body;
  const delegation = await delegationService.nominate({
    nominatorId: req.currentUser.employeeId, delegateId, fromDate, toDate, setById: req.currentUser.employeeId,
  });
  return created(res, delegation);
}

async function createOnBehalf(req, res) {
  const { nominatorId, delegateId, fromDate, toDate } = req.body;
  const delegation = await delegationService.nominateOnBehalf({
    supervisorId: req.currentUser.employeeId, nominatorId, delegateId, fromDate, toDate,
    isHrAdmin: req.currentUser.roles.includes('HR_ADMIN'),
  });
  return created(res, delegation);
}

async function revoke(req, res) {
  const delegation = await delegationService.revoke(
    req.params.delegationId, req.currentUser.employeeId, req.currentUser.roles.includes('HR_ADMIN'),
  );
  return ok(res, delegation);
}

async function mine(req, res) {
  const delegations = await delegationService.listMine(req.currentUser.employeeId);
  return ok(res, delegations);
}

async function listAll(req, res) {
  const delegations = await delegationService.listAll();
  return ok(res, delegations);
}

module.exports = { eligibleDelegates, managers, eligibleForManager, create, createOnBehalf, revoke, mine, listAll };
