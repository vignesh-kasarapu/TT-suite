const express = require('express');
const controller = require('../controllers/reports.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/leave-taken', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), controller.leaveTaken);
router.get('/lop', requireAuth, requireRole('HR_ADMIN'), controller.lop);
router.get('/balances', requireAuth, requireRole('HR_ADMIN'), controller.balances);
router.get('/audit-log', requireAuth, requireRole('HR_ADMIN'), controller.auditLog);

module.exports = router;
