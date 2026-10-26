const express = require('express');
const controller = require('../controllers/holidayView.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', requireAuth, controller.list);

// Self-service: an employee's own optional-holiday quota/selections.
router.get('/optional-summary', requireAuth, controller.optionalSummary);
router.post('/:holidayId/select', requireAuth, controller.selectOptional);
router.delete('/:holidayId/select', requireAuth, controller.deselectOptional);

// Manager/HR acting on behalf of a specific team member — scoped to the caller's own
// reporting hierarchy for a Manager (see assertCanActOnBehalfOf), unrestricted for HR/Admin.
router.get('/optional-summary/:employeeId', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), controller.optionalSummaryForEmployee);
router.post('/:holidayId/select/:employeeId', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), controller.assignOptional);
router.delete('/:holidayId/select/:employeeId', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), controller.unassignOptional);

module.exports = router;
