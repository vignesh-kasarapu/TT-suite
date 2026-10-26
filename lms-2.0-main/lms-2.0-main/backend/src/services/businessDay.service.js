const { eachDayOfInterval, format, getDay } = require('date-fns');
const { Op } = require('sequelize');
const { Holiday, LeaveYear, Employee } = require('../models');
const configService = require('./config.service');
const workingPatternService = require('./workingPattern.service');

/** Holidays scoped to the employee's region (or org-wide, region_id null) — a regional
 * holiday only deducts/displays for employees working in that region. */
async function findHolidaysForEmployee(leaveYearId, employeeId) {
  let employeeRegionId = null;
  if (employeeId) {
    const employee = await Employee.findByPk(employeeId, { attributes: ['region_id'] });
    employeeRegionId = employee ? employee.region_id : null;
  }
  return Holiday.findAll({
    where: {
      leave_year_id: leaveYearId,
      [Op.or]: employeeRegionId ? [{ region_id: null }, { region_id: employeeRegionId }] : [{ region_id: null }],
    },
  });
}

const WEEKDAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * BR-03/04/05/06: computes the deducted-working-day breakdown for a date span.
 * Returns per-day classification so the UI (LMS-036) can render an explicit
 * breakdown, never a bare number.
 *
 * When `employeeId` is supplied, each day is checked against that employee's
 * active working pattern (LMS-015/BR-06) first; only days with no covering
 * pattern fall back to the organisation-wide default weekend. This is what
 * makes BR-06's "two employees on the identical calendar window may fall on
 * opposite sides of a threshold" possible once patterns are assigned.
 */
async function computeDeductionBreakdown({ startDate, endDate, isHalfDay, leaveYearId, employeeId = null }) {
  const [orgWeekendDays, countWeekend, countHoliday] = await Promise.all([
    configService.get('weekend.days'),
    configService.get('weekend.count_within_leave'),
    configService.get('holiday.count_within_leave'),
  ]);

  const holidays = await findHolidaysForEmployee(leaveYearId, employeeId);
  const holidayDates = new Set(holidays.map((h) => h.holiday_date));
  const holidayNameByDate = Object.fromEntries(holidays.map((h) => [h.holiday_date, h.holiday_name]));

  const days = eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) });
  const breakdown = [];
  for (const d of days) {
    const iso = format(d, 'yyyy-MM-dd');
    const weekdayCode = WEEKDAY_CODES[getDay(d)];

    const patternOverride = employeeId ? await workingPatternService.getWeekendOverrideForDate(employeeId, iso) : null;
    const weekendDaysForThisDay = patternOverride || orgWeekendDays;
    const isWeekend = weekendDaysForThisDay.includes(weekdayCode);
    const isHoliday = holidayDates.has(iso);

    let excludedReason = null;
    if (isHoliday && !countHoliday) excludedReason = `Public holiday (${holidayNameByDate[iso]})`;
    else if (isWeekend && !countWeekend) excludedReason = patternOverride ? 'Weekend (individual working pattern)' : 'Weekend';

    breakdown.push({ date: iso, weekdayCode, isWeekend, isHoliday, deducted: excludedReason === null, excludedReason });
  }

  const calendarDaysSelected = days.length;
  let deductedWorkingDays = breakdown.filter((d) => d.deducted).length;

  // BR-34 (Section 4.12): half-day requests deduct 0.5, applies to a single-day span.
  if (isHalfDay && deductedWorkingDays === 1) {
    deductedWorkingDays = 0.5;
  }

  return {
    calendarDaysSelected,
    deductedWorkingDays,
    days: breakdown,
    weekendCounted: countWeekend,
    holidaysCounted: countHoliday,
  };
}

module.exports = { computeDeductionBreakdown, WEEKDAY_CODES };
