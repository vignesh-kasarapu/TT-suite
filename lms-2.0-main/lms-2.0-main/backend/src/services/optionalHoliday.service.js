const { Op } = require('sequelize');
const { Holiday, OptionalHolidaySelection, Employee } = require('../models');
const configService = require('./config.service');
const auditService = require('./audit.service');

/**
 * Per-employee quota of optional (floating) holidays they may select in a leave year.
 * Default is HALF of however many optional holidays are published for that year, rounded
 * UP (an org that publishes 5 optional holidays gives each employee 3 to pick from) — a
 * fixed number would need re-tuning every time the published list changes size. Rounding up
 * rather than down matters at small counts: with only 1 optional holiday published, rounding
 * down would give a quota of 0 and nobody could ever select it. HR/Admin can still override
 * this with a flat number via `holiday.optional_holiday_quota_override` (0 = no override,
 * use the computed default).
 */
async function getOptionalHolidayQuota(leaveYearId) {
  const override = await configService.get('holiday.optional_holiday_quota_override');
  if (override > 0) return override;

  const totalOptional = await Holiday.count({ where: { leave_year_id: leaveYearId, is_optional: true } });
  return Math.ceil(totalOptional / 2);
}

/** Holidays this employee is even eligible to select from: optional, in this leave year,
 * and either org-wide (region_id null) or matching their own region — same eligibility rule
 * businessDay.service.js already applies to holidays generally. */
async function listEligibleOptionalHolidays(employeeId, leaveYearId, employeeRegionId) {
  return Holiday.findAll({
    where: {
      leave_year_id: leaveYearId,
      is_optional: true,
      [Op.or]: employeeRegionId ? [{ region_id: null }, { region_id: employeeRegionId }] : [{ region_id: null }],
    },
    order: [['holiday_date', 'ASC']],
  });
}

/** Quota, how many the employee has already selected, and which specific ones. */
async function getOptionalHolidaySummary(employeeId, leaveYearId, employeeRegionId) {
  const [quota, eligible, selections] = await Promise.all([
    getOptionalHolidayQuota(leaveYearId),
    listEligibleOptionalHolidays(employeeId, leaveYearId, employeeRegionId),
    OptionalHolidaySelection.findAll({ where: { employee_id: employeeId, leave_year_id: leaveYearId } }),
  ]);

  const selectedHolidayIds = new Set(selections.map((s) => s.holiday_id));
  return {
    quota,
    taken: selections.length,
    remaining: Math.max(quota - selections.length, 0),
    eligibleHolidays: eligible.map((h) => ({ ...h.toJSON(), isSelected: selectedHolidayIds.has(h.holiday_id) })),
  };
}

async function selectOptionalHoliday(employeeId, holidayId) {
  const holiday = await Holiday.findByPk(holidayId);
  if (!holiday) throw Object.assign(new Error('Holiday not found.'), { status: 404, code: 'NOT_FOUND' });
  if (!holiday.is_optional) {
    throw Object.assign(new Error('This holiday is mandatory, not optional — nothing to select.'), { status: 400, code: 'NOT_OPTIONAL' });
  }

  const existing = await OptionalHolidaySelection.findOne({ where: { employee_id: employeeId, holiday_id: holidayId } });
  if (existing) return existing; // idempotent — already selected

  const quota = await getOptionalHolidayQuota(holiday.leave_year_id);
  const takenCount = await OptionalHolidaySelection.count({
    where: { employee_id: employeeId, leave_year_id: holiday.leave_year_id },
  });
  if (takenCount >= quota) {
    throw Object.assign(
      new Error(`You've already selected your quota of ${quota} optional holiday(s) for this leave year.`),
      { status: 400, code: 'OPTIONAL_HOLIDAY_QUOTA_EXCEEDED' },
    );
  }

  const selection = await OptionalHolidaySelection.create({
    employee_id: employeeId, holiday_id: holidayId, leave_year_id: holiday.leave_year_id,
  });
  await auditService.record({
    actorId: employeeId, action: 'OPTIONAL_HOLIDAY_SELECTED', entityType: 'optional_holiday_selections', entityId: selection.selection_id,
    newValue: { holidayId, holidayDate: holiday.holiday_date },
  });
  return selection;
}

async function deselectOptionalHoliday(employeeId, holidayId) {
  const existing = await OptionalHolidaySelection.findOne({ where: { employee_id: employeeId, holiday_id: holidayId } });
  if (!existing) return { removed: false };

  await auditService.record({
    actorId: employeeId, action: 'OPTIONAL_HOLIDAY_DESELECTED', entityType: 'optional_holiday_selections', entityId: existing.selection_id,
    priorValue: { holidayId },
  });
  await existing.destroy();
  return { removed: true };
}

/** HR/Admin view: every active employee's optional-holiday usage for a leave year, so HR can
 * see who has and hasn't used their allowance without checking each employee individually. */
async function listOptionalHolidayUsage(leaveYearId) {
  const [quota, employees, selections] = await Promise.all([
    getOptionalHolidayQuota(leaveYearId),
    Employee.findAll({
      where: { is_active: true },
      attributes: ['employee_id', 'full_name', 'first_name', 'last_name', 'employee_code'],
      order: [['first_name', 'ASC'], ['last_name', 'ASC']],
    }),
    OptionalHolidaySelection.findAll({ where: { leave_year_id: leaveYearId } }),
  ]);

  const takenByEmployee = {};
  for (const s of selections) takenByEmployee[s.employee_id] = (takenByEmployee[s.employee_id] || 0) + 1;

  return {
    quota,
    employees: employees.map((e) => {
      const taken = takenByEmployee[e.employee_id] || 0;
      return {
        employeeId: e.employee_id, fullName: e.full_name, employeeCode: e.employee_code,
        taken, remaining: Math.max(quota - taken, 0),
      };
    }),
  };
}

module.exports = {
  getOptionalHolidayQuota, listEligibleOptionalHolidays, getOptionalHolidaySummary,
  selectOptionalHoliday, deselectOptionalHoliday, listOptionalHolidayUsage,
};
