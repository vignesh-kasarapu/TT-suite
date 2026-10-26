/**
 * Demo data seed — run AFTER `npm run seed` (reference data: roles, leave types,
 * management levels, org config, notification templates).
 *
 * Seeds a 10-person org (EMP001-EMP010) with the reporting hierarchy, project/
 * standing-watcher/working-pattern org data, 11 leave requests covering every
 * request state, and 3 delegations covering the primary/supervisor-initiated/
 * fallback paths. Every request and delegation is created through the real
 * service layer (leaveRequest.service.js, delegation.service.js, etc.) — never
 * hand-inserted rows — so ledger postings, approval routing, watchers, and
 * notifications all genuinely execute.
 *
 * Roles are explicit grants: Asha gets HR_ADMIN, and Vikram/Neha/Sanjay each get an
 * explicit MANAGER grant (independent of the reporting hierarchy — see
 * roleAssignment.service.js).
 *
 * Idempotent: every scenario is guarded by a lookup for its own marker before
 * doing any work, so re-running this script against an already-seeded DB is a
 * no-op for whatever already exists.
 *
 * After seeding, runs a self-verification checklist and prints PASS/FAIL for
 * each assertion with the actual value found. Stops immediately (exit code 1)
 * on the first assertion that fails.
 *
 * Run with:  node src/utils/seedDemo.js
 * Prerequisite:  npm run seed
 */
require('dotenv').config();
const { Op } = require('sequelize');
const {
  addDays, addWeeks, addMonths, addYears, nextMonday, format,
} = require('date-fns');
const sequelize = require('../config/database');
const {
  Employee, Department, ManagementLevel, LeaveType, LeavePolicy, LeaveYear, LeaveRequest,
  LeaveLedger, Delegation, Watcher, StandingWatcher, EmployeeRole, Role, AuditLog, LopRecord,
  Holiday, Project, ProjectAssignment, WorkingPattern, WorkingPatternAssignment, Notification,
} = require('../models');
const employeeService = require('../services/employee.service');
const roleAssignmentService = require('../services/roleAssignment.service');
const leaveRequestService = require('../services/leaveRequest.service');
const delegationService = require('../services/delegation.service');
const watcherService = require('../services/watcher.service');
const workingPatternService = require('../services/workingPattern.service');
const adminService = require('../services/admin.service');
const balanceService = require('../services/balance.service');
const approvalRouting = require('../services/approvalRouting.service');
const configService = require('../services/config.service');
const { runLopConversionSweep, escalateOneLevel } = require('../jobs/escalation.job');

const SYSTEM_ACTOR_ID = null; // seed script acts as "the system", same convention the accrual jobs use
const TODAY = new Date();

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
const fmt = (d) => format(d, 'yyyy-MM-dd');

/** A Monday at least `weeksFromNow` weeks out — always a genuine future date. */
function futureMonday(weeksFromNow) {
  return nextMonday(addWeeks(TODAY, weeksFromNow));
}

/** Exactly `numWeekdays` business days (Mon-Fri) starting at `mondayStart`. */
function weekdaySpan(mondayStart, numWeekdays) {
  let count = 0;
  let cur = new Date(mondayStart);
  let end = cur;
  while (count < numWeekdays) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      count += 1;
      end = cur;
    }
    if (count < numWeekdays) cur = addDays(cur, 1);
  }
  return { start: fmt(mondayStart), end: fmt(end) };
}

// A single shared cursor (in weeks-from-today) hands out non-overlapping date windows to
// every scenario below, in call order — so no two requests for the same employee ever
// collide, without having to hand-pick calendar dates.
let cursorWeek = 2;
function reserveWindow(numWeekdays) {
  const monday = futureMonday(cursorWeek);
  const span = weekdaySpan(monday, numWeekdays);
  cursorWeek += Math.ceil(numWeekdays / 5) + 1; // +1 week buffer between windows
  return span;
}

// ---------------------------------------------------------------------------
// Self-verification checklist plumbing
// ---------------------------------------------------------------------------
function check(label, condition, actual) {
  const status = condition ? 'PASS' : 'FAIL';
  const actualStr = actual === undefined ? '' : ` (actual: ${typeof actual === 'object' ? JSON.stringify(actual) : actual})`;
  console.log(`[${status}] ${label}${actualStr}`);
  if (!condition) {
    console.error(`\nSTOPPED: assertion failed — ${label}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Org setup helpers
// ---------------------------------------------------------------------------
async function ensureDepartment(code, name) {
  const [dept] = await Department.findOrCreate({ where: { department_code: code }, defaults: { department_name: name } });
  return dept;
}

async function ensureEmployee({ code, entraOid, email, fullName, designation, departmentId, managementLevelId, managerId, dateOfJoining }) {
  const existing = await Employee.findOne({ where: { employee_code: code } });
  if (existing) {
    // Reconcile against the roster in case this row is leftover from an older seed shape
    // (e.g. missing management_level_id/department) — a plain field update, no onboarding
    // side effects (pro-rata posting, invite email) re-run.
    await existing.update({
      department_id: departmentId,
      management_level_id: managementLevelId,
      designation,
      reporting_manager_id: managerId || null,
      date_of_joining: dateOfJoining,
    });
    return existing;
  }
  return employeeService.onboardEmployee({
    entraOid, workEmail: email, employeeCode: code, fullName, dateOfJoining,
    departmentId, gradeId: null, managementLevelId, designation, reportingManagerId: managerId || null,
  }, SYSTEM_ACTOR_ID);
}

async function findRequestByMarker(employeeId, marker) {
  return LeaveRequest.findOne({ where: { employee_id: employeeId, reason: { [Op.like]: `%${marker}%` } } });
}

async function seedDemo() {
  await sequelize.authenticate();

  const currentYear = await LeaveYear.findOne({ where: { is_current: true } });
  if (!currentYear) {
    throw new Error('No current leave year found. Run `npm run seed` first.');
  }
  const [yearStartStr, yearEndStr] = [currentYear.year_code.split('-')[0], currentYear.year_code.split('-')[1]];
  const nextYearCode = `${Number(yearStartStr) + 1}-${Number(yearEndStr) + 1}`;
  const [nextYear] = await LeaveYear.findOrCreate({
    where: { year_code: nextYearCode },
    defaults: {
      start_date: fmt(addYears(new Date(currentYear.start_date), 1)),
      end_date: fmt(addYears(new Date(currentYear.end_date), 1)),
      is_current: false,
    },
  });

  const annual = await LeaveType.findOne({ where: { type_code: 'ANNUAL' } });
  const casual = await LeaveType.findOne({ where: { type_code: 'CASUAL' } });
  const sick = await LeaveType.findOne({ where: { type_code: 'SICK' } });
  const annualPolicy = await LeavePolicy.findOne({ where: { leave_type_id: annual.leave_type_id } });

  const levels = {};
  for (const code of ['L1', 'L2', 'L3', 'L4', 'L5']) {
    const row = await ManagementLevel.findOne({ where: { level_code: code } });
    levels[code] = row.management_level_id;
  }

  const engineering = await ensureDepartment('ENG', 'Engineering');
  const product = await ensureDepartment('PRD', 'Product');

  // ---------------------------------------------------------------------
  // 1. Roster — created top-down so each manager exists before its reports.
  //    Everyone joins on the leave-year start date (full, non-pro-rated
  //    entitlement) except Aditya, who joins mid-year to genuinely exercise
  //    pro-ration (BR-13/14).
  // ---------------------------------------------------------------------
  const asha = await ensureEmployee({
    code: 'EMP001', entraOid: 'DEV-SEED-EMP001', email: 'asha.rao@example.com', fullName: 'Asha Rao',
    designation: 'HR Business Partner', departmentId: engineering.department_id, managementLevelId: levels.L5,
    managerId: null, dateOfJoining: currentYear.start_date,
  });
  await roleAssignmentService.assignRole(asha.employee_id, 'HR_ADMIN', SYSTEM_ACTOR_ID);

  const vikram = await ensureEmployee({
    code: 'EMP002', entraOid: 'DEV-SEED-EMP002', email: 'vikram.shah@example.com', fullName: 'Vikram Shah',
    designation: 'Engineering Manager', departmentId: engineering.department_id, managementLevelId: levels.L4,
    managerId: asha.employee_id, dateOfJoining: currentYear.start_date,
  });
  await roleAssignmentService.assignRole(vikram.employee_id, 'MANAGER', SYSTEM_ACTOR_ID);

  const priya = await ensureEmployee({
    code: 'EMP003', entraOid: 'DEV-SEED-EMP003', email: 'priya.nair@example.com', fullName: 'Priya Nair',
    designation: 'Software Engineer', departmentId: engineering.department_id, managementLevelId: levels.L2,
    managerId: vikram.employee_id, dateOfJoining: currentYear.start_date,
  });

  const rohan = await ensureEmployee({
    code: 'EMP004', entraOid: 'DEV-SEED-EMP004', email: 'rohan.mehta@example.com', fullName: 'Rohan Mehta',
    designation: 'Software Engineer', departmentId: engineering.department_id, managementLevelId: levels.L2,
    managerId: vikram.employee_id, dateOfJoining: currentYear.start_date,
  });

  const neha = await ensureEmployee({
    code: 'EMP005', entraOid: 'DEV-SEED-EMP005', email: 'neha.kapoor@example.com', fullName: 'Neha Kapoor',
    designation: 'Product Manager', departmentId: product.department_id, managementLevelId: levels.L4,
    managerId: asha.employee_id, dateOfJoining: currentYear.start_date,
  });
  await roleAssignmentService.assignRole(neha.employee_id, 'MANAGER', SYSTEM_ACTOR_ID);

  const arjun = await ensureEmployee({
    code: 'EMP006', entraOid: 'DEV-SEED-EMP006', email: 'arjun.desai@example.com', fullName: 'Arjun Desai',
    designation: 'Product Analyst', departmentId: product.department_id, managementLevelId: levels.L2,
    managerId: neha.employee_id, dateOfJoining: currentYear.start_date,
  });

  const kavya = await ensureEmployee({
    code: 'EMP007', entraOid: 'DEV-SEED-EMP007', email: 'kavya.iyer@example.com', fullName: 'Kavya Iyer',
    designation: 'Product Analyst', departmentId: product.department_id, managementLevelId: levels.L2,
    managerId: neha.employee_id, dateOfJoining: currentYear.start_date,
  });

  const sanjay = await ensureEmployee({
    code: 'EMP008', entraOid: 'DEV-SEED-EMP008', email: 'sanjay.verma@example.com', fullName: 'Sanjay Verma',
    designation: 'Team Lead', departmentId: engineering.department_id, managementLevelId: levels.L3,
    managerId: vikram.employee_id, dateOfJoining: currentYear.start_date,
  });
  await roleAssignmentService.assignRole(sanjay.employee_id, 'MANAGER', SYSTEM_ACTOR_ID);

  const meera = await ensureEmployee({
    code: 'EMP009', entraOid: 'DEV-SEED-EMP009', email: 'meera.joshi@example.com', fullName: 'Meera Joshi',
    designation: 'Associate Engineer', departmentId: engineering.department_id, managementLevelId: levels.L1,
    managerId: sanjay.employee_id, dateOfJoining: currentYear.start_date,
  });

  // Mid-leave-year join date (15 Jan of the year the current leave year ends) — pro-ration target.
  const adityaJoinDate = `${Number(yearEndStr)}-01-15`;
  const aditya = await ensureEmployee({
    code: 'EMP010', entraOid: 'DEV-SEED-EMP010', email: 'aditya.rao@example.com', fullName: 'Aditya Rao',
    designation: 'Software Engineer', departmentId: engineering.department_id, managementLevelId: levels.L2,
    managerId: vikram.employee_id, dateOfJoining: adityaJoinDate,
  });

  // ---------------------------------------------------------------------
  // 2. Org data
  // ---------------------------------------------------------------------

  // Project "Atlas": lead = Neha, assigned employee = Priya, effective for the current leave year.
  let atlas = await Project.findOne({ where: { project_code: 'ATLAS' } });
  if (!atlas) atlas = await adminService.createProject({ code: 'ATLAS', name: 'Atlas' }, asha.employee_id);
  const atlasAssignment = await ProjectAssignment.findOne({ where: { employee_id: priya.employee_id, project_id: atlas.project_id } });
  if (!atlasAssignment) {
    await adminService.assignProject({
      employeeId: priya.employee_id, projectId: atlas.project_id, projectLeadId: neha.employee_id,
      effectiveFrom: currentYear.start_date, effectiveTo: currentYear.end_date,
    }, asha.employee_id);
  }

  // Standing watcher: Asha sets Neha as a standing watcher on Meera (outside Neha's own line), current leave year.
  const standingWatcherExisting = await StandingWatcher.findOne({
    where: { watched_employee_id: meera.employee_id, watcher_employee_id: neha.employee_id },
  });
  if (!standingWatcherExisting) {
    await watcherService.addStandingWatcher({
      watchedEmployeeId: meera.employee_id, watcherEmployeeId: neha.employee_id,
      fromDate: currentYear.start_date, toDate: currentYear.end_date,
      addedById: asha.employee_id, addedByIsHrAdmin: true,
    });
  }

  // Working pattern: Sanjay gets a custom Thu/Fri weekend for a 3-month window. Placed at the
  // start of the current leave year (safely before any future-dated leave request below), so
  // it never entangles with his own leave request's day-count.
  let thuFriPattern = await WorkingPattern.findOne({ where: { pattern_code: 'THU_FRI_WEEKEND' } });
  if (!thuFriPattern) {
    thuFriPattern = await workingPatternService.createPattern(
      { patternCode: 'THU_FRI_WEEKEND', patternName: 'Thursday/Friday Weekend', weekendDays: ['THU', 'FRI'] },
      asha.employee_id,
    );
  }
  const sanjayPatternExisting = await WorkingPatternAssignment.findOne({ where: { employee_id: sanjay.employee_id } });
  if (!sanjayPatternExisting) {
    await workingPatternService.assignPattern({
      employeeId: sanjay.employee_id, workingPatternId: thuFriPattern.working_pattern_id,
      effectiveFrom: currentYear.start_date, effectiveTo: fmt(addMonths(new Date(currentYear.start_date), 3)),
      assignedBy: asha.employee_id,
    });
  }

  // Holidays: 2 "safe" ones (won't collide with any leave request below) + 1 in the next leave
  // year. The 3rd current-year holiday is added later, deliberately inside Rohan's cancelled span.
  async function ensureHoliday(name, date, leaveYearId) {
    const existing = await Holiday.findOne({ where: { holiday_name: name } });
    if (existing) return existing;
    const { holiday } = await adminService.addHoliday({ date, name, leaveYearId }, asha.employee_id);
    return holiday;
  }
  await ensureHoliday('Seed Holiday A', fmt(addDays(new Date(currentYear.start_date), 10)), currentYear.leave_year_id);
  await ensureHoliday('Seed Holiday B', fmt(addDays(new Date(currentYear.start_date), 40)), currentYear.leave_year_id);
  await ensureHoliday('Seed Holiday Next Year', fmt(addDays(new Date(nextYear.start_date), 10)), nextYear.leave_year_id);

  // ---------------------------------------------------------------------
  // 3. Leave requests — one per target state, driven through the real service layer.
  // ---------------------------------------------------------------------

  // #1 Priya — Annual, 2 days -> PENDING_MANAGER
  let req1 = await findRequestByMarker(priya.employee_id, '[SEED-01]');
  if (!req1) {
    const w = reserveWindow(2);
    req1 = await leaveRequestService.submitRequest({
      employeeId: priya.employee_id, leaveTypeId: annual.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Family function [SEED-01]',
    });
  }

  // #2a Rohan — Casual, 1 day, approved
  let req2a = await findRequestByMarker(rohan.employee_id, '[SEED-02A]');
  if (!req2a) {
    const w = reserveWindow(1);
    req2a = await leaveRequestService.submitRequest({
      employeeId: rohan.employee_id, leaveTypeId: casual.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Personal errand [SEED-02A]',
    });
    req2a = await leaveRequestService.decide({ requestId: req2a.request_id, actorId: vikram.employee_id, decision: 'APPROVE', reason: '' });
  }

  // #2b Rohan — second request, Annual, approved, then a holiday lands inside its span, then cancelled
  let req2b = await findRequestByMarker(rohan.employee_id, '[SEED-02B]');
  if (!req2b) {
    const w = reserveWindow(3);
    req2b = await leaveRequestService.submitRequest({
      employeeId: rohan.employee_id, leaveTypeId: annual.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Family trip [SEED-02B]',
    });
    req2b = await leaveRequestService.decide({ requestId: req2b.request_id, actorId: vikram.employee_id, decision: 'APPROVE', reason: '' });

    // 7.3.15: holiday added inside an already-approved leave span — exercises the warning path.
    await ensureHoliday('Seed Holiday Inside Approved Span', w.start, currentYear.leave_year_id);

    req2b = await leaveRequestService.requestCancellation({ requestId: req2b.request_id, employeeId: rohan.employee_id });
    req2b = await leaveRequestService.decideCancellation({
      requestId: req2b.request_id, actorId: vikram.employee_id, decision: 'APPROVE', unelapsedDays: req2b.deducted_days,
    });
  }

  // #3 Meera — Annual, 3 days, saved but never submitted -> DRAFT
  let req3 = await LeaveRequest.findOne({ where: { employee_id: meera.employee_id, reason: { [Op.like]: '%[SEED-03]%' } } });
  if (!req3) {
    const w = reserveWindow(3);
    req3 = await leaveRequestService.saveDraft({
      employeeId: meera.employee_id, leaveTypeId: annual.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Planned trip [SEED-03]',
    });
  }

  // #4 Arjun — Annual, 12 deducted days (> long-leave threshold), approved by Neha -> PENDING_HR
  let req4 = await findRequestByMarker(arjun.employee_id, '[SEED-04]');
  if (!req4) {
    const w = reserveWindow(12);
    req4 = await leaveRequestService.submitRequest({
      employeeId: arjun.employee_id, leaveTypeId: annual.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Extended annual leave [SEED-04]',
    });
    req4 = await leaveRequestService.decide({ requestId: req4.request_id, actorId: neha.employee_id, decision: 'APPROVE', reason: '' });
  }

  // #5 Sanjay — Casual, 2 days, rejected by Vikram (not advance leave) -> REJECTED
  let req5 = await findRequestByMarker(sanjay.employee_id, '[SEED-05]');
  if (!req5) {
    const w = reserveWindow(2);
    req5 = await leaveRequestService.submitRequest({
      employeeId: sanjay.employee_id, leaveTypeId: casual.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Casual leave [SEED-05]',
    });
    req5 = await leaveRequestService.decide({
      requestId: req5.request_id, actorId: vikram.employee_id, decision: 'REJECT', reason: 'Team coverage constraints during this period.',
    });
  }

  // #6 Aditya — Annual, exceeds his pro-rated effective balance, rejected -> REJECTED_PENDING_WITHDRAWAL (day 3 of 7)
  let req6 = await findRequestByMarker(aditya.employee_id, '[SEED-06]');
  if (!req6) {
    const w = reserveWindow(8);
    req6 = await leaveRequestService.submitRequest({
      employeeId: aditya.employee_id, leaveTypeId: annual.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Annual leave [SEED-06]',
    });
    req6 = await leaveRequestService.decide({
      requestId: req6.request_id, actorId: vikram.employee_id, decision: 'REJECT', reason: 'Insufficient balance for this request.',
    });
    await req6.update({ withdrawal_window_end: addDays(new Date(), 4) }); // 3 of 7 days elapsed
  }

  // #7 Meera — Casual, 1 day, submitted then withdrawn before decision -> WITHDRAWN
  let req7 = await LeaveRequest.findOne({ where: { employee_id: meera.employee_id, reason: { [Op.like]: '%[SEED-07]%' } } });
  if (!req7) {
    const w = reserveWindow(1);
    req7 = await leaveRequestService.submitRequest({
      employeeId: meera.employee_id, leaveTypeId: casual.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Casual leave [SEED-07]',
    });
    req7 = await leaveRequestService.withdraw({ requestId: req7.request_id, employeeId: meera.employee_id });
  }

  // #8 Kavya — Annual, advance leave, rejected, window expired -> converted to LOP_APPLIED (BR-20)
  let req8 = await findRequestByMarker(kavya.employee_id, '[SEED-08]');
  if (!req8) {
    const w = reserveWindow(Number(annualPolicy.annual_entitlement) + 1); // guaranteed to exceed her full balance
    req8 = await leaveRequestService.submitRequest({
      employeeId: kavya.employee_id, leaveTypeId: annual.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Extended trip [SEED-08]',
    });
    req8 = await leaveRequestService.decide({
      requestId: req8.request_id, actorId: neha.employee_id, decision: 'REJECT', reason: 'Cannot accommodate this span; exceeds available balance.',
    });
    await req8.update({ withdrawal_window_end: addDays(new Date(), -1) }); // force the window to have expired
    await runLopConversionSweep();
    req8 = await LeaveRequest.findByPk(req8.request_id);
  }

  // #9 Priya — second Annual request, approved, cancellation requested but not yet decided -> CANCELLATION_REQUESTED
  let req9 = await findRequestByMarker(priya.employee_id, '[SEED-09]');
  if (!req9) {
    const w = reserveWindow(2);
    req9 = await leaveRequestService.submitRequest({
      employeeId: priya.employee_id, leaveTypeId: annual.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Annual leave [SEED-09]',
    });
    req9 = await leaveRequestService.decide({ requestId: req9.request_id, actorId: vikram.employee_id, decision: 'APPROVE', reason: '' });
    req9 = await leaveRequestService.requestCancellation({ requestId: req9.request_id, employeeId: priya.employee_id });
  }

  // #10 Arjun — Sick, 4 deducted days (crosses the 3-day alert threshold), approved -> APPROVED + sick alerts
  let req10 = await findRequestByMarker(arjun.employee_id, '[SEED-10]');
  if (!req10) {
    const w = reserveWindow(4);
    req10 = await leaveRequestService.submitRequest({
      employeeId: arjun.employee_id, leaveTypeId: sick.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Sick leave [SEED-10]',
    });
    req10 = await leaveRequestService.decide({ requestId: req10.request_id, actorId: neha.employee_id, decision: 'APPROVE', reason: '' });
  }

  // #11 Kavya — Casual, half-day (first half), approved -> APPROVED
  let req11 = await findRequestByMarker(kavya.employee_id, '[SEED-11]');
  if (!req11) {
    const w = reserveWindow(1);
    req11 = await leaveRequestService.submitRequest({
      employeeId: kavya.employee_id, leaveTypeId: casual.leave_type_id, startDate: w.start, endDate: w.start,
      isHalfDay: true, halfDayPortion: 'FIRST', reason: 'Half day [SEED-11]',
    });
    req11 = await leaveRequestService.decide({ requestId: req11.request_id, actorId: neha.employee_id, decision: 'APPROVE', reason: '' });
  }

  // #12 Rohan — Casual, 1 day, submitted to Vikram (his manager) who never decides within the
  // SLA window -> the SLA sweep escalates it one level, to Vikram's own manager, Asha (HR/Admin).
  // Demonstrates the escalation flow end-to-end: same mechanism escalation.job.js#runSlaSweep
  // would trigger for real once `approval.sla_working_days` elapses, just fast-forwarded here by
  // backdating sla_started_at instead of waiting — everything else (routing, notifications,
  // audit trail) runs through the real escalateOneLevel(), not hand-inserted.
  let req12 = await findRequestByMarker(rohan.employee_id, '[SEED-12]');
  if (!req12) {
    const w = reserveWindow(1);
    req12 = await leaveRequestService.submitRequest({
      employeeId: rohan.employee_id, leaveTypeId: casual.leave_type_id, startDate: w.start, endDate: w.end,
      isHalfDay: false, reason: 'Escalation demo [SEED-12]',
    });
    const slaWorkingDays = await configService.get('approval.sla_working_days');
    await req12.update({ sla_started_at: addDays(new Date(), -(Number(slaWorkingDays) + 3)) });
    await escalateOneLevel(req12);
    req12 = await LeaveRequest.findByPk(req12.request_id);
  }

  // ---------------------------------------------------------------------
  // 4. Delegations
  // ---------------------------------------------------------------------
  const del1From = fmt(addWeeks(TODAY, 100));
  const del1To = fmt(addWeeks(TODAY, 102));
  const del2From = fmt(addWeeks(TODAY, 104));
  const del2To = fmt(addWeeks(TODAY, 106));
  const del3From = fmt(addWeeks(TODAY, 108));
  const del3To = fmt(addWeeks(TODAY, 110));

  // #1 Vikram nominates Neha (his peer under Asha) — PRIMARY path (LMS-041).
  let del1 = await Delegation.findOne({ where: { nominator_id: vikram.employee_id, delegate_id: neha.employee_id, set_by_id: vikram.employee_id } });
  if (!del1) {
    del1 = await delegationService.nominate({
      nominatorId: vikram.employee_id, delegateId: neha.employee_id, fromDate: del1From, toDate: del1To,
      setById: vikram.employee_id, allowFallback: true,
    });
  }

  // #2 Asha (Vikram's real supervisor) sets a delegate on Vikram's behalf — SUPERVISOR-INITIATED path (LMS-042).
  let del2 = await Delegation.findOne({ where: { nominator_id: vikram.employee_id, delegate_id: neha.employee_id, set_by_id: asha.employee_id } });
  if (!del2) {
    del2 = await delegationService.nominateOnBehalf({
      supervisorId: asha.employee_id, nominatorId: vikram.employee_id, delegateId: neha.employee_id,
      fromDate: del2From, toDate: del2To, isHrAdmin: false,
    });
  }

  // #3 Sanjay (sole L3 under Vikram, no peer) — resolves to Vikram via fallback (LMS-041).
  let del3 = await Delegation.findOne({ where: { nominator_id: sanjay.employee_id, delegate_id: vikram.employee_id, set_by_id: sanjay.employee_id } });
  if (!del3) {
    del3 = await delegationService.nominate({
      nominatorId: sanjay.employee_id, delegateId: vikram.employee_id, fromDate: del3From, toDate: del3To,
      setById: sanjay.employee_id, allowFallback: true,
    });
  }

  // ---------------------------------------------------------------------
  // 5. Self-verification checklist
  // ---------------------------------------------------------------------
  console.log('\n=== Self-verification checklist ===\n');

  const vikramIsManager = await approvalRouting.hasRole(vikram.employee_id, 'MANAGER');
  const nehaIsManager = await approvalRouting.hasRole(neha.employee_id, 'MANAGER');
  const sanjayIsManager = await approvalRouting.hasRole(sanjay.employee_id, 'MANAGER');
  check('Vikram has an explicit Manager role grant', vikramIsManager === true, vikramIsManager);
  check('Neha has an explicit Manager role grant', nehaIsManager === true, nehaIsManager);
  check('Sanjay has an explicit Manager role grant', sanjayIsManager === true, sanjayIsManager);

  const demoManagerGrants = await EmployeeRole.count({
    include: [{ model: Role, where: { role_code: 'MANAGER' }, attributes: [] }],
    where: { employee_id: { [Op.in]: [vikram.employee_id, neha.employee_id, sanjay.employee_id] } },
  });
  check('Vikram, Neha and Sanjay each hold exactly one MANAGER grant', demoManagerGrants === 3, demoManagerGrants);

  const sanjayDirectReports = await Employee.count({ where: { reporting_manager_id: sanjay.employee_id, is_active: true } });
  check('Sanjay currently has exactly 1 active direct report (Meera)', sanjayDirectReports === 1, sanjayDirectReports);

  check('#1 Priya Annual 2d is PENDING_MANAGER', req1.state === 'PENDING_MANAGER', req1.state);
  check('#2a Rohan Casual 1d is APPROVED', req2a.state === 'APPROVED', req2a.state);
  check('#2b Rohan Annual (approved then cancelled) is CANCELLED', req2b.state === 'CANCELLED', req2b.state);
  check('#3 Meera Annual 3d draft is DRAFT', req3.state === 'DRAFT', req3.state);
  check('#4 Arjun Annual 12d is PENDING_HR', req4.state === 'PENDING_HR', req4.state);
  check('#5 Sanjay Casual 2d is REJECTED', req5.state === 'REJECTED', req5.state);
  check('#6 Aditya Annual (advance) is REJECTED_PENDING_WITHDRAWAL', req6.state === 'REJECTED_PENDING_WITHDRAWAL', req6.state);
  check('#7 Meera Casual 1d is WITHDRAWN', req7.state === 'WITHDRAWN', req7.state);
  check('#8 Kavya Annual (advance, expired window) is LOP_APPLIED', req8.state === 'LOP_APPLIED', req8.state);
  check('#9 Priya Annual (approved) is CANCELLATION_REQUESTED', req9.state === 'CANCELLATION_REQUESTED', req9.state);
  check('#10 Arjun Sick 4d is APPROVED', req10.state === 'APPROVED', req10.state);
  check('#11 Kavya Casual half-day is APPROVED', req11.state === 'APPROVED', req11.state);
  check(
    // Escalation moves current_approver_id up the management chain (Vikram -> his own
    // manager, Asha) — it stays PENDING_MANAGER, not PENDING_HR, since that's still a
    // manager-stage decision, just made by whoever now holds it (BR-35/36).
    "#12 Rohan Casual 1d (SLA-breached under Vikram) escalated to Asha, still PENDING_MANAGER",
    req12.state === 'PENDING_MANAGER' && String(req12.current_approver_id) === String(asha.employee_id),
    { state: req12.state, current_approver_id: req12.current_approver_id },
  );
  const req12EscalationAudit = await AuditLog.findOne({
    where: { action: 'SLA_ESCALATED', entity_type: 'leave_requests', entity_id: String(req12.request_id) },
  });
  check('#12 escalation was recorded in the audit trail', !!req12EscalationAudit, req12EscalationAudit?.audit_id);
  const req12RequesterNotice = await Notification.findOne({
    where: { recipient_id: rohan.employee_id, related_request_id: req12.request_id, template_key: 'REQUEST_ESCALATED' },
  });
  check(
    "#12 Rohan was notified his request escalated, naming Asha as the new approver",
    !!req12RequesterNotice && req12RequesterNotice.body.includes('Asha Rao'),
    req12RequesterNotice?.body,
  );

  const del1Eligibility = await delegationService.getEligibleDelegates(vikram.employee_id);
  check(
    'Delegation #1 (Vikram -> Neha) resolves to a peer manager, not fallback',
    del1Eligibility.fallbackUsed === false && del1Eligibility.candidates.some((c) => String(c.employee_id) === String(neha.employee_id)),
    { fallbackUsed: del1Eligibility.fallbackUsed, candidateIds: del1Eligibility.candidates.map((c) => c.employee_id) },
  );

  const del3Eligibility = await delegationService.getEligibleDelegates(sanjay.employee_id);
  const del3CandidateIds = del3Eligibility.candidates.map((c) => c.employee_id);
  check(
    "Delegation #3 (Sanjay) resolves to Vikram via fallback, and Sanjay's eligible-delegate list contains no unrelated managers",
    del3Eligibility.fallbackUsed === true && del3CandidateIds.length === 1 && String(del3CandidateIds[0]) === String(vikram.employee_id),
    { fallbackUsed: del3Eligibility.fallbackUsed, candidateIds: del3CandidateIds },
  );

  const arjunLedgerEntry = await LeaveLedger.findOne({ where: { source_reference: `leave_request:${req4.request_id}` } });
  check("Arjun's PENDING_HR request has no ledger deduction entry yet (BR-45/LMS-046)", arjunLedgerEntry === null, arjunLedgerEntry ? arjunLedgerEntry.entry_type : null);

  const kavyaLopRecord = await LopRecord.findOne({ where: { request_id: req8.request_id } });
  check("Kavya's LOP_APPLIED request kept its original row (linked LopRecord, same request_id)", !!kavyaLopRecord, kavyaLopRecord ? kavyaLopRecord.lop_record_id : null);
  const kavyaLopAudit = await AuditLog.findOne({ where: { action: 'LOP_CONVERSION', entity_id: String(req8.request_id) } });
  check("Kavya's LOP conversion has a linked audit entry", !!kavyaLopAudit, kavyaLopAudit ? kavyaLopAudit.audit_id : null);

  const priyaProjectWatcher = await Watcher.findOne({ where: { request_id: req1.request_id, watcher_employee_id: neha.employee_id } });
  check(
    "Priya's project-lead watcher (Neha, via Atlas) appears automatically on her requests, without being manually added",
    !!priyaProjectWatcher && String(priyaProjectWatcher.added_by_id) === String(priya.employee_id),
    priyaProjectWatcher ? { addedById: priyaProjectWatcher.added_by_id } : null,
  );

  const meeraStandingWatcher = await Watcher.findOne({ where: { request_id: req7.request_id, watcher_employee_id: neha.employee_id } });
  check("Meera's standing watcher (Neha) appears on a request raised after the standing watcher was set", !!meeraStandingWatcher, meeraStandingWatcher ? meeraStandingWatcher.watcher_id : null);

  async function verifyEffectiveBalance(employee, leaveType) {
    const ledgerBalance = (await LeaveLedger.sum('quantity', {
      where: { employee_id: employee.employee_id, leave_type_id: leaveType.leave_type_id, leave_year_id: currentYear.leave_year_id },
    })) || 0;
    const openRequests = await LeaveRequest.findAll({
      where: {
        employee_id: employee.employee_id, leave_type_id: leaveType.leave_type_id, leave_year_id: currentYear.leave_year_id,
        state: { [Op.in]: balanceService.OPEN_COMMITMENT_STATES },
      },
    });
    const committed = openRequests.reduce((sum, r) => sum + parseFloat(r.deducted_days || 0), 0);
    const expected = parseFloat(ledgerBalance) - committed;
    const actual = await balanceService.getEffectiveBalance(employee.employee_id, leaveType.leave_type_id, currentYear.leave_year_id);
    check(
      `BR-10 effective balance matches for ${employee.full_name} / ${leaveType.type_name}`,
      Math.abs(actual.effectiveBalance - expected) < 0.001,
      { expected, actual: actual.effectiveBalance },
    );
  }
  await verifyEffectiveBalance(priya, annual);
  await verifyEffectiveBalance(arjun, annual);
  await verifyEffectiveBalance(aditya, annual);
  await verifyEffectiveBalance(kavya, annual);

  const totalDaysInYear = (new Date(currentYear.end_date) - new Date(currentYear.start_date)) / 86400000 + 1;
  const daysFromJoinToYearEnd = (new Date(currentYear.end_date) - new Date(aditya.date_of_joining)) / 86400000 + 1;
  const expectedOpening = Math.ceil(Number(annualPolicy.annual_entitlement) * (daysFromJoinToYearEnd / totalDaysInYear));
  const aditiyaOpeningEntry = await LeaveLedger.findOne({
    where: { employee_id: aditya.employee_id, leave_type_id: annual.leave_type_id, entry_type: 'OPENING_PRO_RATA_CREDIT' },
  });
  check(
    "Aditya's opening Annual entitlement was pro-rated and rounded up (BR-13/14), not entered manually",
    !!aditiyaOpeningEntry && Number(aditiyaOpeningEntry.quantity) === expectedOpening,
    { expected: expectedOpening, actual: aditiyaOpeningEntry ? Number(aditiyaOpeningEntry.quantity) : null },
  );

  const sickAlerts = await Notification.findAll({ where: { related_request_id: req10.request_id, template_key: 'EXTENDED_SICK_LEAVE_ALERT' } });
  check("Arjun's 4-day sick request (crosses the 3-day threshold) triggered EXTENDED_SICK_LEAVE_ALERT notifications", sickAlerts.length > 0, sickAlerts.length);

  const seedHoliday = await Holiday.findOne({ where: { holiday_name: 'Seed Holiday Inside Approved Span' } });
  const insideSpan = !!seedHoliday && seedHoliday.holiday_date >= req2b.start_date && seedHoliday.holiday_date <= req2b.end_date;
  check(
    "Holiday added inside Rohan's approved span exercised the warning path",
    insideSpan,
    { holidayDate: seedHoliday ? seedHoliday.holiday_date : null, span: `${req2b.start_date}..${req2b.end_date}` },
  );

  console.log('\nAll checklist assertions passed.\n');
  console.log('Sign-in codes for DEV_AUTH_BYPASS_EMPLOYEE_CODE: EMP001 (HR/Admin) through EMP010 (Employee).');
}

seedDemo()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Demo seed failed:', err);
    process.exit(1);
  });
