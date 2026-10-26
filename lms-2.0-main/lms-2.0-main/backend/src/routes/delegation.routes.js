const express = require('express');
const controller = require('../controllers/delegation.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/eligible', requireAuth, requireRole('MANAGER'), controller.eligibleDelegates);
router.get('/managers', requireAuth, requireRole('HR_ADMIN'), controller.managers);
router.get('/eligible-for/:nominatorId', requireAuth, requireRole('HR_ADMIN'), controller.eligibleForManager);
router.get('/mine', requireAuth, requireRole('MANAGER'), controller.mine);
router.get('/', requireAuth, requireRole('HR_ADMIN'), controller.listAll);
router.post('/', requireAuth, requireRole('MANAGER'), controller.create);
router.post('/on-behalf', requireAuth, requireRole('MANAGER'), controller.createOnBehalf);
router.post('/:delegationId/revoke', requireAuth, requireRole('MANAGER'), controller.revoke);

module.exports = router;
