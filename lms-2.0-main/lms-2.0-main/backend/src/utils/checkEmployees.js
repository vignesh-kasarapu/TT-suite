require('dotenv').config();
const sequelize = require('../config/database');
const { Employee, Role } = require('../models');

async function check() {
  await sequelize.authenticate();
  const employees = await Employee.findAll({
    include: [{ model: Role }],
  });

  console.log('\n================ EMPLOYEES IN DATABASE ================');
  for (const emp of employees) {
    const roles = emp.Roles?.map((r) => r.role_code).join(', ') || 'EMPLOYEE';
    console.log(`[ID: ${emp.employee_id}] ${emp.full_name} | Code: ${emp.employee_code} | Email: ${emp.work_email} | OID: ${emp.entra_oid} | Status: ${emp.status} | Roles: ${roles}`);
  }
  console.log('========================================================\n');
  process.exit(0);
}

check().catch((err) => {
  console.error(err);
  process.exit(1);
});
