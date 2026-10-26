const express = require('express');
const controller = require('../controllers/notificationCentre.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', requireAuth, controller.list);
router.get('/unread-count', requireAuth, controller.unreadCount);
router.post('/:notificationId/read', requireAuth, controller.markRead);
router.post('/mark-all-read', requireAuth, controller.markAllRead);

module.exports = router;
