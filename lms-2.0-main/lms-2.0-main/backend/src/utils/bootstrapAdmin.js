require('dotenv').config();
const sequelize = require('../config/database');
const { Role, Employee } = require('../models');
const roleAssignmentService = require('../services/roleAssignment.service');

/**
 * Creates the very first HR/Admin for a brand-new organization. Every other onboarding
 * path (Administration -> Employees) is HR_ADMIN-gated (requireRole in
 * auth.middleware.js), and requireAuth itself refuses any request that doesn't map to an
 * existing employee row (LMS-002/005) — so on an empty database there is no UI or API path
 * that can create the first admin. This script is that one-time, run-directly-on-the-DB
 * exception. Idempotent: safe to re-run (matches an existing employee by work email and
 * just makes sure they hold HR_ADMIN, instead of erroring or duplicating).
 *
 * Usage: set BOOTSTRAP_ADMIN_* env vars (in backend/.env or inline) and run
 * `npm run bootstrap:admin` from backend/.
 */
async function bootstrapAdmin() {
  const workEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const employeeCode = process.env.BOOTSTRAP_ADMIN_CODE?.trim();
  const fullName = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
  const dateOfJoining = process.env.BOOTSTRAP_ADMIN_JOIN_DATE?.trim() || new Date().toISOString().slice(0, 10);
  const designation = process.env.BOOTSTRAP_ADMIN_DESIGNATION?.trim() || 'HR Admin';

  const missing = [
    ['BOOTSTRAP_ADMIN_EMAIL', workEmail],
    ['BOOTSTRAP_ADMIN_CODE', employeeCode],
    ['BOOTSTRAP_ADMIN_NAME', fullName],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(`Missing required env var(s): ${missing.join(', ')}\n` +
      'Set them and re-run, e.g.:\n' +
      '  BOOTSTRAP_ADMIN_EMAIL=you@yourorg.com BOOTSTRAP_ADMIN_CODE=EMP001 BOOTSTRAP_ADMIN_NAME="Your Name" npm run bootstrap:admin');
    process.exit(1);
  }

  await sequelize.authenticate();
  await sequelize.sync();

  // Safety net if `npm run seed` hasn't been run yet — roleAssignmentService needs these rows.
  await Promise.all([
    Role.findOrCreate({ where: { role_code: 'EMPLOYEE' }, defaults: { role_name: 'Employee' } }),
    Role.findOrCreate({ where: { role_code: 'HR_ADMIN' }, defaults: { role_name: 'HR / Admin' } }),
  ]);

  const [employee, created] = await Employee.findOrCreate({
    where: { work_email: workEmail },
    defaults: { employee_code: employeeCode, full_name: fullName, date_of_joining: dateOfJoining, designation },
  });

  await roleAssignmentService.assignRole(employee.employee_id, 'HR_ADMIN', employee.employee_id);

  // eslint-disable-next-line no-console
  console.log(
    `${created ? 'Created' : 'Found existing'} employee #${employee.employee_id} ` +
    `(${employee.work_email}, code ${employee.employee_code}) and confirmed HR_ADMIN.\n` +
    'Sign in via Entra SSO with this work email, or point DEV_AUTH_BYPASS_EMPLOYEE_CODE ' +
    `at "${employee.employee_code}" for local testing without Entra configured.`,
  );
  process.exit(0);
}

bootstrapAdmin().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
