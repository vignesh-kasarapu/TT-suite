const adminService = require('../services/admin.service');
const { ok, created } = require('../utils/apiResponse');

const departments = {
  list: async (req, res) => ok(res, await adminService.listDepartments()),
  create: async (req, res) => created(res, await adminService.createDepartment(req.body, req.currentUser.employeeId)),
};

const managementLevels = {
  list: async (req, res) => ok(res, await adminService.listManagementLevels()),
};

const grades = {
  list: async (req, res) => ok(res, await adminService.listGrades()),
  create: async (req, res) => created(res, await adminService.createGrade(req.body, req.currentUser.employeeId)),
};

const regions = {
  list: async (req, res) => ok(res, await adminService.listRegions()),
  create: async (req, res) => created(res, await adminService.createRegion(req.body, req.currentUser.employeeId)),
};

const projects = {
  list: async (req, res) => ok(res, await adminService.listProjects()),
  create: async (req, res) => created(res, await adminService.createProject(req.body, req.currentUser.employeeId)),
  assign: async (req, res) => created(res, await adminService.assignProject(req.body, req.currentUser.employeeId)),
};

const leaveTypes = {
  list: async (req, res) => ok(res, await adminService.listLeaveTypes()),
  create: async (req, res) => created(res, await adminService.createLeaveType(req.body, req.currentUser.employeeId)),
  updatePolicy: async (req, res) => ok(res, await adminService.updateLeaveTypePolicy(req.params.leaveTypeId, req.body, req.currentUser.employeeId)),
};

const optionalHolidayService = require('../services/optionalHoliday.service');
const holidays = {
  list: async (req, res) => ok(res, await adminService.listHolidays(req.query.leaveYearId)),
  create: async (req, res) => created(res, await adminService.addHoliday(req.body, req.currentUser.employeeId)),
  remove: async (req, res) => ok(res, await adminService.removeHoliday(req.params.holidayId, req.currentUser.employeeId)),
  optionalUsage: async (req, res) => ok(res, await optionalHolidayService.listOptionalHolidayUsage(req.query.leaveYearId)),
};

const selfApprovalService = require('../services/selfApproval.service');
const selfApproval = {
  list: async (req, res) => ok(res, await selfApprovalService.listAll()),
  grant: async (req, res) => created(res, await selfApprovalService.grant({ ...req.body, grantedBy: req.currentUser.employeeId })),
  revoke: async (req, res) => ok(res, await selfApprovalService.revoke(req.params.grantId, req.currentUser.employeeId)),
};

module.exports = { departments, managementLevels, grades, regions, projects, leaveTypes, holidays, selfApproval };

const workingPatternService = require('../services/workingPattern.service');
const workingPatterns = {
  list: async (req, res) => ok(res, await workingPatternService.listPatterns({ includeInactive: req.query.includeInactive === 'true' })),
  create: async (req, res) => created(res, await workingPatternService.createPattern(req.body, req.currentUser.employeeId)),
  assign: async (req, res) => created(res, await workingPatternService.assignPattern({ ...req.body, assignedBy: req.currentUser.employeeId })),
  assignments: async (req, res) => ok(res, await workingPatternService.listAssignments()),
  updateAssignment: async (req, res) => ok(res, await workingPatternService.updateAssignment(req.params.assignmentId, req.body, req.currentUser.employeeId)),
  deactivate: async (req, res) => ok(res, await workingPatternService.deactivatePattern(req.params.workingPatternId, req.currentUser.employeeId)),
  reactivate: async (req, res) => ok(res, await workingPatternService.reactivatePattern(req.params.workingPatternId, req.currentUser.employeeId)),
};
module.exports.workingPatterns = workingPatterns;

const { runYearEndCarryForward } = require('../jobs/carryForward.job');
module.exports.carryForward = {
  trigger: async (req, res) => {
    await runYearEndCarryForward(req.body.leaveYearId);
    return ok(res, { triggered: true });
  },
};
