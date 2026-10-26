const { EmployeeRole, Role, Employee } = require('../models');
const auditService = require('./audit.service');

/**
 * HR/Admin grants an explicit role (EMPLOYEE, MANAGER, or HR_ADMIN) to an employee. Idempotent.
 * Accepts an optional `{ transaction }` so callers creating the employee in the same active
 * transaction (e.g. bulkImport.service.js) can grant the role against that not-yet-committed row.
 */
async function assignRole(employeeId, roleCode, actorId, options = {}) {
  const { transaction } = options;
  const role = await Role.findOne({ where: { role_code: roleCode }, transaction });
  if (!role) throw Object.assign(new Error(`Unknown role code: ${roleCode}`), { status: 400, code: 'UNKNOWN_ROLE' });

  const employee = await Employee.findByPk(employeeId, { transaction });
  if (!employee) throw Object.assign(new Error('Employee not found'), { status: 404, code: 'NOT_FOUND' });

  const existing = await EmployeeRole.findOne({ where: { employee_id: employeeId, role_id: role.role_id }, transaction });
  if (existing) return existing; // idempotent — already holds the role

  const grant = await EmployeeRole.create({ employee_id: employeeId, role_id: role.role_id, assigned_by: actorId }, { transaction });

  // LMS-009: an audit entry is written for every role change. EmployeeRole has a composite
  // (employee_id, role_id) key, not a single id column, so that pair is the entity reference.
  await auditService.record({
    actorId, action: 'ROLE_ASSIGNED', entityType: 'employee_roles', entityId: `${employeeId}:${role.role_id}`,
    newValue: { employeeId, roleCode }, transaction,
  });
  return grant;
}

/**
 * Revokes a role. Role assignment rule: "At least one HR/Admin must exist at
 * all times; the system must prevent removal of the last one." Enforced here,
 * not left to the caller.
 * Accepts an optional `{ transaction }` so callers revoking roles as part of a larger
 * transactional operation (e.g. employeeLifecycle.service.js's deactivate()) see a
 * consistent view and roll back cleanly together with the rest of that operation.
 */
async function revokeRole(employeeId, roleCode, actorId, options = {}) {
  const { transaction } = options;
  const role = await Role.findOne({ where: { role_code: roleCode }, transaction });
  if (!role) throw Object.assign(new Error(`Unknown role code: ${roleCode}`), { status: 400, code: 'UNKNOWN_ROLE' });

  const existing = await EmployeeRole.findOne({ where: { employee_id: employeeId, role_id: role.role_id }, transaction });
  if (!existing) return { removed: false };

  if (roleCode === 'HR_ADMIN') {
    const hrAdminCount = await EmployeeRole.count({ where: { role_id: role.role_id }, transaction });
    if (hrAdminCount <= 1) {
      throw Object.assign(
        new Error('At least one HR/Admin must exist at all times. This is the last one and cannot be removed.'),
        { status: 400, code: 'LAST_HR_ADMIN' },
      );
    }
  }

  await auditService.record({
    actorId, action: 'ROLE_REVOKED', entityType: 'employee_roles', entityId: `${employeeId}:${role.role_id}`,
    priorValue: { employeeId, roleCode }, transaction,
  });
  await existing.destroy({ transaction });
  return { removed: true };
}

async function listRolesForEmployee(employeeId) {
  const rows = await EmployeeRole.findAll({
    where: { employee_id: employeeId },
    include: [{ model: Role, attributes: ['role_code', 'role_name'] }],
  });
  return rows.map((r) => r.Role.role_code);
}

module.exports = { assignRole, revokeRole, listRolesForEmployee };
