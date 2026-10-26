require('dotenv').config();
const sequelize = require('../config/database');
const { LeaveType, LeavePolicy, LeaveLedger, LeaveYear, Employee } = require('../models');

async function updateQuotas() {
  await sequelize.authenticate();

  const quotaMap = {
    ANNUAL: 24,
    CASUAL: 15,
    SICK: 9,
  };

  const leaveYear = await LeaveYear.findOne({ where: { is_current: true } });
  const employees = await Employee.findAll();

  for (const [code, newEntitlement] of Object.entries(quotaMap)) {
    const leaveType = await LeaveType.findOne({ where: { type_code: code } });
    if (!leaveType) continue;

    // Update LeavePolicy
    await LeavePolicy.update(
      { annual_entitlement: newEntitlement },
      { where: { leave_type_id: leaveType.leave_type_id } }
    );

    // Update or recreate opening ledger entries for all employees
    for (const emp of employees) {
      // Find existing opening pro-rata credit
      const existingOpening = await LeaveLedger.findOne({
        where: {
          employee_id: emp.employee_id,
          leave_type_id: leaveType.leave_type_id,
          entry_type: 'OPENING_PRO_RATA_CREDIT',
        },
      });

      if (existingOpening) {
        existingOpening.quantity = newEntitlement;
        await existingOpening.save();
      } else {
        await LeaveLedger.create({
          employee_id: emp.employee_id,
          leave_type_id: leaveType.leave_type_id,
          leave_year_id: leaveYear?.leave_year_id || 1,
          entry_type: 'OPENING_PRO_RATA_CREDIT',
          quantity: newEntitlement,
          source_reference: `quota_update:${emp.employee_id}`,
          is_system_actor: true,
        });
      }
    }
  }

  console.log('Successfully updated leave quotas: Annual = 24, Casual = 15, Sick = 9 across database.');
  process.exit(0);
}

updateQuotas().catch((err) => {
  console.error('Failed to update leave quotas:', err);
  process.exit(1);
});
