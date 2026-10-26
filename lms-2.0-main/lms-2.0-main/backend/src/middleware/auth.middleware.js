const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { Employee, EmployeeRole, Role } = require('../models');

/**
 * LMS-002: application session is Claude's own JWT, issued after successful Entra
 * auth, valid until midnight local (configured tz). LMS-008: authorisation is
 * evaluated per request against the user's CURRENT role assignment — this
 * middleware re-reads the employee + roles from the DB every request; it never
 * trusts role claims cached in the token itself.
 */
async function requireAuth(req, res, next) {
  try {
    let employeeId;

    if (env.devAuthBypass.enabled) {
      // LMS-006: gated behind an explicit env var, refused to start in production (see config/env.js).
      const employee = await Employee.findOne({ where: { employee_code: env.devAuthBypass.employeeCode } });
      if (!employee) return res.status(401).json({ success: false, error: { code: 'DEV_BYPASS_MISCONFIGURED', message: 'DEV_AUTH_BYPASS_EMPLOYEE_CODE does not match an employee.' } });
      employeeId = employee.employee_id;
    } else {
      const token = req.cookies?.[env.session.cookieName];
      if (!token) return res.status(401).json({ success: false, error: { code: 'NO_SESSION', message: 'Sign in required.' } });
      const payload = jwt.verify(token, env.session.jwtSecret);
      employeeId = payload.employeeId;
    }

    const employee = await Employee.findByPk(employeeId);
    if (!employee || employee.status !== 'ACTIVE') {
      return res.status(401).json({ success: false, error: { code: 'NO_EMPLOYEE_RECORD', message: 'No active employee record. Contact HR.' } });
    }

    const employeeRoles = await EmployeeRole.findAll({
      where: { employee_id: employeeId },
      include: [{ model: Role, attributes: ['role_code'] }],
    });
    const roleCodes = ['EMPLOYEE', ...employeeRoles.map((er) => er.Role.role_code)];

    req.currentUser = { employeeId: employee.employee_id, employee, roles: [...new Set(roleCodes)] };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: { code: 'SESSION_INVALID', message: 'Session expired or invalid. Please sign in again.' } });
  }
}

/** LMS-005: server-side role/scope authorisation on every endpoint that needs it. */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const userRoles = req.currentUser?.roles || [];
    const permitted = allowedRoles.some((r) => userRoles.includes(r));
    if (!permitted) {
      return res.status(403).json({ success: false, error: { code: 'PERMISSION_DENIED', message: 'You do not have access to this action.' } });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
