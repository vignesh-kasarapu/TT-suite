const express = require('express');
const controller = require('../controllers/config.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('HR_ADMIN'), controller.listAll);
router.patch('/:key', requireAuth, requireRole('HR_ADMIN'), controller.updateOne);

module.exports = router;
