const { Holiday, LeaveYear, Employee } = require('../models');
const { Op } = require('sequelize');
const { ok, created } = require('../utils/apiResponse');
const optionalHolidayService = require('../services/optionalHoliday.service');
const employeeService = require('../services/employee.service');

/** A Manager may only act on behalf of their own reporting hierarchy; HR/Admin is
 * unrestricted. Mirrors r3.controller.js#compOff.credit's exact scoping pattern. */
async function assertCanActOnBehalfOf(req, res, targetEmployeeId) {
  if (req.currentUser.roles.includes('HR_ADMIN')) return true;
  const inHierarchy = await employeeService.isInManagerHierarchy(req.currentUser.employeeId, targetEmployeeId);
  if (!inHierarchy) {
    res.status(403).json({ success: false, error: { code: 'PERMISSION_DENIED', message: 'You can only manage optional holidays for your own team.' } });
    return false;
  }
  return true;
}

/** LMS-077: all users view the holiday calendar for the current and next leave year,
 * scoped to their own region of working (plus org-wide, region-less holidays). */
async function list(req, res) {
  const years = await LeaveYear.findAll({
    where: { is_closed: false },
    order: [['start_date', 'ASC']],
    limit: 2,
  });
  const yearIds = years.map((y) => y.leave_year_id);
  const employeeRegionId = req.currentUser.employee.region_id;

  const holidays = await Holiday.findAll({
    where: {
      leave_year_id: { [Op.in]: yearIds },
      [Op.or]: employeeRegionId ? [{ region_id: null }, { region_id: employeeRegionId }] : [{ region_id: null }],
    },
    order: [['holiday_date', 'ASC']],
  });
  return ok(res, holidays);
}

/** Quota + eligible optional holidays + which ones this employee has already selected, for
 * whichever leave year is passed (defaults to the current one). */
async function optionalSummary(req, res) {
  const leaveYearId = req.query.leaveYearId
    ? Number(req.query.leaveYearId)
    : (await LeaveYear.findOne({ where: { is_current: true } }))?.leave_year_id;
  if (!leaveYearId) return ok(res, { quota: 0, taken: 0, remaining: 0, eligibleHolidays: [] });

  const summary = await optionalHolidayService.getOptionalHolidaySummary(
    req.currentUser.employeeId, leaveYearId, req.currentUser.employee.region_id,
  );
  return ok(res, summary);
}

async function selectOptional(req, res) {
  const selection = await optionalHolidayService.selectOptionalHoliday(req.currentUser.employeeId, req.params.holidayId);
  return created(res, selection);
}

async function deselectOptional(req, res) {
  const result = await optionalHolidayService.deselectOptionalHoliday(req.currentUser.employeeId, req.params.holidayId);
  return ok(res, result);
}

/** Manager/HR view of a specific team member's optional-holiday quota + selections —
 * same shape as optionalSummary above, just for someone other than the caller. */
async function optionalSummaryForEmployee(req, res) {
  if (!(await assertCanActOnBehalfOf(req, res, req.params.employeeId))) return;

  const employee = await Employee.findByPk(req.params.employeeId);
  if (!employee) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found.' } });

  const leaveYearId = req.query.leaveYearId
    ? Number(req.query.leaveYearId)
    : (await LeaveYear.findOne({ where: { is_current: true } }))?.leave_year_id;
  if (!leaveYearId) return ok(res, { quota: 0, taken: 0, remaining: 0, eligibleHolidays: [] });

  const summary = await optionalHolidayService.getOptionalHolidaySummary(employee.employee_id, leaveYearId, employee.region_id);
  return ok(res, summary);
}

/** Manager assigns (or HR assigns) an optional holiday to a specific team member — the
 * same quota/eligibility rules apply as employee self-selection (selectOptionalHoliday
 * doesn't care who called it, only whose quota it's checking). */
async function assignOptional(req, res) {
  if (!(await assertCanActOnBehalfOf(req, res, req.params.employeeId))) return;
  const selection = await optionalHolidayService.selectOptionalHoliday(req.params.employeeId, req.params.holidayId);
  return created(res, selection);
}

async function unassignOptional(req, res) {
  if (!(await assertCanActOnBehalfOf(req, res, req.params.employeeId))) return;
  const result = await optionalHolidayService.deselectOptionalHoliday(req.params.employeeId, req.params.holidayId);
  return ok(res, result);
}

module.exports = {
  list, optionalSummary, selectOptional, deselectOptional,
  optionalSummaryForEmployee, assignOptional, unassignOptional,
};
