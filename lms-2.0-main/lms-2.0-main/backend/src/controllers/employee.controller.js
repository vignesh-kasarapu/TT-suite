const path = require('path');
const fs = require('fs');
const multer = require('multer');
const employeeService = require('../services/employee.service');
const { Employee } = require('../models');
const { ok, created } = require('../utils/apiResponse');

// Profile pictures: lower sensitivity than leave-request attachments (NFR-10 is written for
// those), but still served only through this authenticated route, never a static/public path.
const AVATAR_STORAGE_ROOT = path.resolve(__dirname, '../../../storage/avatars');
fs.mkdirSync(AVATAR_STORAGE_ROOT, { recursive: true });
const AVATAR_MAX_SIZE_BYTES = 3 * 1024 * 1024; // 3MB
const AVATAR_ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_STORAGE_ROOT),
    filename: (req, file, cb) => cb(null, `${req.currentUser.employeeId}-${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: AVATAR_MAX_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!AVATAR_ALLOWED_MIME.includes(file.mimetype)) {
      return cb(Object.assign(new Error('Unsupported file type. Allowed: PNG, JPEG, WEBP.'), { status: 400, code: 'VALIDATION_ERROR' }));
    }
    cb(null, true);
  },
});

async function me(req, res) {
  return ok(res, { employee: req.currentUser.employee, roles: req.currentUser.roles });
}

/** Self-service profile edit — LMS "Edit profile" (personal details only, see
 * employeeService.updateOwnProfile's allow-list). Always scoped to the caller's own record;
 * never accepts an employeeId from the request. */
async function updateMyProfile(req, res) {
  const employee = await employeeService.updateOwnProfile(req.currentUser.employeeId, req.body, req.currentUser.employeeId);
  return ok(res, employee);
}

async function uploadMyAvatar(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No image file was received.' } });
  }
  const employee = await employeeService.updateOwnAvatar(req.currentUser.employeeId, req.file.path);
  return ok(res, employee);
}

/** Any authenticated user may view any active employee's avatar (same sensitivity as seeing
 * their name in the directory) — streamed inline so it can be used directly as an <img src>. */
async function getAvatar(req, res) {
  const employee = await Employee.findByPk(req.params.employeeId);
  if (!employee?.avatar_path || !fs.existsSync(employee.avatar_path)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No profile picture set.' } });
  }
  return res.sendFile(employee.avatar_path);
}

async function dashboard(req, res) {
  const data = await employeeService.getDashboard(req.currentUser.employeeId);
  return ok(res, data);
}

async function list(req, res) {
  const employees = await employeeService.listEmployees(req.query);
  return ok(res, employees);
}

async function createEmployee(req, res) {
  const employee = await employeeService.onboardEmployee(req.body, req.currentUser.employeeId);
  return created(res, employee);
}

async function updateManager(req, res) {
  const employee = await employeeService.setReportingManager(
    req.params.employeeId, req.body.managerId, req.currentUser.employeeId,
  );
  return ok(res, employee);
}

async function updateDetails(req, res) {
  const employee = await employeeService.updateEmployeeDetails(req.params.employeeId, req.body, req.currentUser.employeeId);
  return ok(res, employee);
}

async function myTeam(req, res) {
  const team = await employeeService.getTeamBalances(req.currentUser.employeeId);
  return ok(res, team);
}

async function peerCalendar(req, res) {
  const peers = await employeeService.getPeerCalendar(req.currentUser.employeeId, req.query);
  return ok(res, peers);
}

async function teamCalendar(req, res) {
  const entries = await employeeService.getTeamCalendar(req.currentUser.employeeId, req.query);
  return ok(res, entries);
}

async function watchableEmployees(req, res) {
  const employees = await employeeService.listWatchableEmployees();
  return ok(res, employees);
}

module.exports = {
  me, dashboard, list, createEmployee, updateManager, updateDetails, myTeam, peerCalendar, teamCalendar, watchableEmployees,
  updateMyProfile, uploadMyAvatar, getAvatar, avatarUpload,
};
