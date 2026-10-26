const roleAssignmentService = require('../services/roleAssignment.service');
const { ok, created } = require('../utils/apiResponse');

async function assign(req, res) {
  const grant = await roleAssignmentService.assignRole(req.params.employeeId, req.body.roleCode, req.currentUser.employeeId);
  return created(res, grant);
}

async function revoke(req, res) {
  const result = await roleAssignmentService.revokeRole(req.params.employeeId, req.body.roleCode, req.currentUser.employeeId);
  return ok(res, result);
}

async function list(req, res) {
  const roles = await roleAssignmentService.listRolesForEmployee(req.params.employeeId);
  return ok(res, roles);
}

module.exports = { assign, revoke, list };
