const watcherService = require('../services/watcher.service');
const { ok, created } = require('../utils/apiResponse');

async function listStanding(req, res) {
  const rows = await watcherService.listStandingWatchers(
    req.params.employeeId, req.currentUser.employeeId, req.currentUser.roles.includes('HR_ADMIN'),
  );
  return ok(res, rows);
}

async function createStanding(req, res) {
  const { watcherEmployeeId, fromDate, toDate } = req.body;
  const standing = await watcherService.addStandingWatcher({
    watchedEmployeeId: req.params.employeeId,
    watcherEmployeeId,
    fromDate,
    toDate,
    addedById: req.currentUser.employeeId,
    addedByIsHrAdmin: req.currentUser.roles.includes('HR_ADMIN'),
  });
  return created(res, standing);
}

module.exports = { listStanding, createStanding };
