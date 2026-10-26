const lifecycleService = require('../services/employeeLifecycle.service');
const { ok } = require('../utils/apiResponse');

async function deactivate(req, res) {
  const result = await lifecycleService.deactivate({
    employeeId: req.params.employeeId,
    lastWorkingDay: req.body.lastWorkingDay,
    actorId: req.currentUser.employeeId,
  });
  return ok(res, result);
}

async function reassignManager(req, res) {
  const result = await lifecycleService.reassignManager({
    employeeId: req.params.employeeId,
    newManagerId: req.body.newManagerId,
    transferPendingRequests: !!req.body.transferPendingRequests,
    actorId: req.currentUser.employeeId,
  });
  return ok(res, result);
}

module.exports = { deactivate, reassignManager };
