const sequelize = require('../config/database');

const Employee = require('./employee.model');
const Role = require('./role.model');
const EmployeeRole = require('./employeeRole.model');
const ManagementLevel = require('./managementLevel.model');
const Department = require('./department.model');
const Grade = require('./grade.model');
const Region = require('./region.model');
const Project = require('./project.model');
const ProjectAssignment = require('./projectAssignment.model');
const LeaveType = require('./leaveType.model');
const LeavePolicy = require('./leavePolicy.model');
const LeaveAccrualConfig = require('./leaveAccrualConfig.model');
const LeaveYear = require('./leaveYear.model');
const Holiday = require('./holiday.model');
const OrganizationConfig = require('./organizationConfig.model');
const LeaveRequest = require('./leaveRequest.model');
const LeaveRequestAttachment = require('./leaveRequestAttachment.model');
const LeaveRequestApproval = require('./leaveRequestApproval.model');
const Delegation = require('./delegation.model');
const Watcher = require('./watcher.model');
const StandingWatcher = require('./standingWatcher.model');
const LeaveLedger = require('./leaveLedger.model');
const Notification = require('./notification.model');
const NotificationTemplate = require('./notificationTemplate.model');
const AuditLog = require('./auditLog.model');
const ScheduledJobRun = require('./scheduledJobRun.model');
const LopRecord = require('./lopRecord.model');
const SelfApprovalPermission = require('./selfApprovalPermission.model');

// R2
const WorkingPattern = require('./workingPattern.model');
const WorkingPatternAssignment = require('./workingPatternAssignment.model');
const ManagerReassignmentLog = require('./managerReassignmentLog.model');
const NotificationDigestPreference = require('./notificationDigestPreference.model');
const EmployeeFinalSettlement = require('./employeeFinalSettlement.model');

// R3
const BlackoutPeriod = require('./blackoutPeriod.model');
const TeamCapacityLimit = require('./teamCapacityLimit.model');
const LeaveEncashmentRequest = require('./leaveEncashmentRequest.model');
const CompensatoryOffCredit = require('./compensatoryOffCredit.model');
const CalendarFeedSubscription = require('./calendarFeedSubscription.model');
const OptionalHolidaySelection = require('./optionalHolidaySelection.model');

// ---------------- Associations ----------------

// Employee hierarchy & org structure
Employee.belongsTo(Employee, { as: 'manager', foreignKey: 'reporting_manager_id' });
Employee.hasMany(Employee, { as: 'directReports', foreignKey: 'reporting_manager_id' });
Employee.belongsTo(Department, { foreignKey: 'department_id' });
Employee.belongsTo(Grade, { foreignKey: 'grade_id' });
Employee.belongsTo(Region, { foreignKey: 'region_id' });
Employee.belongsTo(ManagementLevel, { foreignKey: 'management_level_id' });

// Roles: EMPLOYEE/MANAGER/HR_ADMIN are all explicit grants via employee_roles
// (see roleAssignment.service.js / approvalRouting.service.js#hasRole).
Employee.belongsToMany(Role, { through: EmployeeRole, foreignKey: 'employee_id', otherKey: 'role_id' });
Role.belongsToMany(Employee, { through: EmployeeRole, foreignKey: 'role_id', otherKey: 'employee_id' });
EmployeeRole.belongsTo(Employee, { foreignKey: 'employee_id' });
EmployeeRole.belongsTo(Role, { foreignKey: 'role_id' });

// Projects
Project.hasMany(ProjectAssignment, { foreignKey: 'project_id' });
ProjectAssignment.belongsTo(Project, { foreignKey: 'project_id' });
ProjectAssignment.belongsTo(Employee, { as: 'employee', foreignKey: 'employee_id' });
ProjectAssignment.belongsTo(Employee, { as: 'projectLead', foreignKey: 'project_lead_id' });

// Leave types / policy / accrual — 1:1
LeaveType.hasOne(LeavePolicy, { foreignKey: 'leave_type_id' });
LeavePolicy.belongsTo(LeaveType, { foreignKey: 'leave_type_id' });
LeaveType.hasOne(LeaveAccrualConfig, { foreignKey: 'leave_type_id' });
LeaveAccrualConfig.belongsTo(LeaveType, { foreignKey: 'leave_type_id' });

// Leave year / holidays
LeaveYear.hasMany(Holiday, { foreignKey: 'leave_year_id' });
Holiday.belongsTo(LeaveYear, { foreignKey: 'leave_year_id' });
Holiday.belongsTo(Region, { foreignKey: 'region_id' });
Holiday.hasMany(OptionalHolidaySelection, { foreignKey: 'holiday_id' });
OptionalHolidaySelection.belongsTo(Holiday, { foreignKey: 'holiday_id' });
OptionalHolidaySelection.belongsTo(Employee, { foreignKey: 'employee_id' });

// Leave request — core aggregate
Employee.hasMany(LeaveRequest, { foreignKey: 'employee_id' });
LeaveRequest.belongsTo(Employee, { as: 'employee', foreignKey: 'employee_id' });
LeaveRequest.belongsTo(LeaveType, { foreignKey: 'leave_type_id' });
LeaveRequest.belongsTo(LeaveType, { as: 'priorLeaveType', foreignKey: 'prior_leave_type_id' });
LeaveRequest.belongsTo(LeaveYear, { foreignKey: 'leave_year_id' });
LeaveRequest.belongsTo(Employee, { as: 'currentApprover', foreignKey: 'current_approver_id' });

LeaveRequest.hasMany(LeaveRequestAttachment, { foreignKey: 'request_id', as: 'attachments' });
LeaveRequestAttachment.belongsTo(LeaveRequest, { foreignKey: 'request_id' });

LeaveRequest.hasMany(LeaveRequestApproval, { foreignKey: 'request_id', as: 'approvals' });
LeaveRequestApproval.belongsTo(LeaveRequest, { foreignKey: 'request_id' });
LeaveRequestApproval.belongsTo(Employee, { as: 'actor', foreignKey: 'actor_id' });
LeaveRequestApproval.belongsTo(Employee, { as: 'onBehalfOf', foreignKey: 'on_behalf_of_id' });

LeaveRequest.hasMany(Watcher, { foreignKey: 'request_id', as: 'watchers' });
Watcher.belongsTo(LeaveRequest, { foreignKey: 'request_id' });
Watcher.belongsTo(Employee, { as: 'watcherEmployee', foreignKey: 'watcher_employee_id' });

Employee.hasMany(StandingWatcher, { as: 'standingWatchersOnMe', foreignKey: 'watched_employee_id' });
StandingWatcher.belongsTo(Employee, { as: 'watchedEmployee', foreignKey: 'watched_employee_id' });
StandingWatcher.belongsTo(Employee, { as: 'watcherEmployee', foreignKey: 'watcher_employee_id' });

// Delegation
Delegation.belongsTo(Employee, { as: 'nominator', foreignKey: 'nominator_id' });
Delegation.belongsTo(Employee, { as: 'delegate', foreignKey: 'delegate_id' });

// Ledger — append-only
Employee.hasMany(LeaveLedger, { foreignKey: 'employee_id', as: 'ledgerEntries' });
LeaveLedger.belongsTo(Employee, { foreignKey: 'employee_id' });
LeaveLedger.belongsTo(LeaveType, { foreignKey: 'leave_type_id' });
LeaveLedger.belongsTo(LeaveYear, { foreignKey: 'leave_year_id' });

// Notifications
Notification.belongsTo(Employee, { as: 'recipient', foreignKey: 'recipient_id' });
Notification.belongsTo(LeaveRequest, { foreignKey: 'related_request_id' });

// Audit
AuditLog.belongsTo(Employee, { as: 'actor', foreignKey: 'actor_id' });

// LOP
LopRecord.belongsTo(LeaveRequest, { foreignKey: 'request_id' });
LopRecord.belongsTo(Employee, { foreignKey: 'employee_id' });

// Self-approval addendum (table 37)
SelfApprovalPermission.belongsTo(Employee, { as: 'grantee', foreignKey: 'employee_id' });
SelfApprovalPermission.belongsTo(Employee, { as: 'grantedBy', foreignKey: 'granted_by' });

// R2
WorkingPatternAssignment.belongsTo(Employee, { foreignKey: 'employee_id' });
WorkingPatternAssignment.belongsTo(WorkingPattern, { foreignKey: 'working_pattern_id' });
ManagerReassignmentLog.belongsTo(Employee, { as: 'employee', foreignKey: 'employee_id' });
NotificationDigestPreference.belongsTo(Employee, { foreignKey: 'employee_id' });
EmployeeFinalSettlement.belongsTo(Employee, { foreignKey: 'employee_id' });

// R3
TeamCapacityLimit.belongsTo(Employee, { as: 'managerEmployee', foreignKey: 'manager_employee_id' });
LeaveEncashmentRequest.belongsTo(Employee, { foreignKey: 'employee_id' });
CompensatoryOffCredit.belongsTo(Employee, { foreignKey: 'employee_id' });
CalendarFeedSubscription.belongsTo(Employee, { foreignKey: 'employee_id' });

module.exports = {
  sequelize,
  Employee, Role, EmployeeRole, ManagementLevel, Department, Grade, Region,
  Project, ProjectAssignment, LeaveType, LeavePolicy, LeaveAccrualConfig,
  LeaveYear, Holiday, OrganizationConfig, LeaveRequest, LeaveRequestAttachment,
  LeaveRequestApproval, Delegation, Watcher, StandingWatcher, LeaveLedger,
  Notification, NotificationTemplate, AuditLog, ScheduledJobRun, LopRecord,
  SelfApprovalPermission,
  WorkingPattern, WorkingPatternAssignment, ManagerReassignmentLog,
  NotificationDigestPreference, EmployeeFinalSettlement,
  BlackoutPeriod, TeamCapacityLimit, LeaveEncashmentRequest,
  CompensatoryOffCredit, CalendarFeedSubscription, OptionalHolidaySelection,
};
