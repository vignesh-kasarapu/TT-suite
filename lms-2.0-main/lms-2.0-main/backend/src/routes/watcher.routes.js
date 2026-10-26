const express = require('express');
const controller = require('../controllers/watcher.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/:employeeId/standing-watchers', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), controller.listStanding);
router.post('/:employeeId/standing-watchers', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), controller.createStanding);

module.exports = router;
