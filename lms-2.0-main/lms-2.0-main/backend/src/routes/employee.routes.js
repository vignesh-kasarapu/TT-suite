const express = require('express');
const employeeController = require('../controllers/employee.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/me', requireAuth, employeeController.me);
router.patch('/me', requireAuth, employeeController.updateMyProfile);
router.post('/me/avatar', requireAuth, employeeController.avatarUpload.single('avatar'), employeeController.uploadMyAvatar);
router.get('/dashboard', requireAuth, employeeController.dashboard);
router.get('/', requireAuth, requireRole('HR_ADMIN'), employeeController.list);
router.post('/', requireAuth, requireRole('HR_ADMIN'), employeeController.createEmployee);
router.get('/:employeeId/avatar', requireAuth, employeeController.getAvatar);
router.patch('/:employeeId/manager', requireAuth, requireRole('HR_ADMIN'), employeeController.updateManager);
router.patch('/:employeeId', requireAuth, requireRole('HR_ADMIN'), employeeController.updateDetails);
router.get('/my-team', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), employeeController.myTeam);
router.get('/peer-calendar', requireAuth, employeeController.peerCalendar);
router.get('/team-calendar', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), employeeController.teamCalendar);
router.get('/watchable', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), employeeController.watchableEmployees);

const lifecycleController = require('../controllers/employeeLifecycle.controller');
router.post('/:employeeId/deactivate', requireAuth, requireRole('HR_ADMIN'), lifecycleController.deactivate);
router.post('/:employeeId/reassign-manager', requireAuth, requireRole('HR_ADMIN'), lifecycleController.reassignManager);

const bulkImportController = require('../controllers/bulkImport.controller');
router.post('/bulk-import', requireAuth, requireRole('HR_ADMIN'), bulkImportController.upload.single('file'), bulkImportController.importEmployees);

const roleAssignmentController = require('../controllers/roleAssignment.controller');
router.get('/:employeeId/roles', requireAuth, requireRole('HR_ADMIN'), roleAssignmentController.list);
router.post('/:employeeId/roles', requireAuth, requireRole('HR_ADMIN'), roleAssignmentController.assign);
router.delete('/:employeeId/roles', requireAuth, requireRole('HR_ADMIN'), roleAssignmentController.revoke);

const notificationAdminController = require('../controllers/notificationAdmin.controller');
router.get('/me/digest-preference', requireAuth, requireRole('MANAGER'), notificationAdminController.getMyDigestPreference);
router.patch('/me/digest-preference', requireAuth, requireRole('MANAGER'), notificationAdminController.setMyDigestPreference);

module.exports = router;
